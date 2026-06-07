# Local dev — run, debug, smoke-test

Plain guide for running echo end-to-end on your laptop and poking it
when something looks off. No production / deploy material here — see
RUNBOOK for that.

## Prerequisites

- Docker Desktop (or any Docker engine with compose v2)
- Node.js 24 + pnpm (`corepack enable && corepack prepare pnpm@latest --activate`)
- Optional, recommended: Bruno (`brew install bruno bruno-cli`) for
  poking endpoints with structured assertions.
- `curl` and `jq` for ad-hoc HTTP probing.

The Docker images install everything else the sidecar needs
(PhoneInfoga binary, exiftool, Python deps, ignorant CLI, …). No
host-level Python work required.

## First-run

```bash
cp .env.example .env       # tweak values if you want; defaults work for dev
docker compose up -d --build
docker compose ps          # all 5 containers should be (healthy) within ~20s
```

You should end up with:

| service | port (host) | role |
| --- | --- | --- |
| `echo-api` | `127.0.0.1:3000` | NestJS API, accepts `POST /api/lookups`, streams SSE at `/api/lookups/<id>/stream` |
| `echo-osint-py` | `127.0.0.1:8000` | Python sidecar (Sherlock/Maigret/exiftool/etc), plus an internal PhoneInfoga REST server on container-local port 5111 |
| `echo-postgres` | `127.0.0.1:5432` | DB; user/pass/db = `echo`/`changeme`/`echo` |
| `echo-redis` | `127.0.0.1:6379` | BullMQ queue + SSE event bus |
| `echo-worker` | — | BullMQ worker, no public port |

If any healthcheck is still `(starting)` after a minute, jump to
[Debugging](#debugging).

## Smoke tests

### Liveness

```bash
curl -fsS http://localhost:3000/api/health/live
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:3000/api/providers | jq '.[].id'
curl -fsS http://localhost:8000/info | jq '.providers[].id'
```

The two `id` lists should match. If they diverge, one side has a
registered provider the other doesn't — see
`apps/{api,worker}/src/app.module.ts` and `services/echo-osint-py/app/main.py`.

### One-shot provider (sync JSON via sidecar)

```bash
curl -s -X POST http://localhost:8000/providers/phonenumbers/run \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+48537529192"}' | jq
```

### Streaming provider (via API, full pipeline)

```bash
LOOKUP_ID=$(curl -s -X POST http://localhost:3000/api/lookups \
  -H 'Content-Type: application/json' \
  -d '{"providerId":"sherlock","query":{"username":"efinswim"}}' \
  | jq -r .id)
curl -N http://localhost:3000/api/lookups/$LOOKUP_ID/stream
```

Each line is one SSE event:

```
id: 1779654987037-0
data: {"_tag":"Started"}

id: 1779654987200-0
data: {"_tag":"Partial","chunk":{"site":"GitHub","url":"https://github.com/efinswim"}}

id: 1779654987980-0
data: {"_tag":"Final","data":{"found":[…],"checked":407}}
```

Resume mid-stream with `-H 'Last-Event-ID: 1779654987037-0'` — the
event store replays from there.

### Bruno

`bruno open bruno/echo-api`, pick the `local` environment, run
anything from `lookups/` or `sidecar/`. Every `create-*` reads
`testUsername` / `testEmail` / `testPhone` from the environment —
change the values in `environments/local.bru` to retarget without
editing the requests.

```bash
# Or from the CLI:
bru run bruno/echo-api/lookups/create-sherlock.bru --env local
bru run bruno/echo-api/sidecar/phoneinfoga-run.bru --env local
```

## Cancel and re-do

```bash
# Take everything down (preserves volumes — Postgres + Redis state survives)
docker compose down

# Same but nuke volumes too
docker compose down -v

# Rebuild a single service after editing its Dockerfile / pyproject.toml
docker compose up -d --build osint-py
```

## Debugging

### Container is unhealthy or restarting

```bash
docker compose ps
docker compose logs --tail 50 osint-py     # or api / worker / postgres / redis
docker compose logs -f api                 # follow
```

`echo-osint-py` boots `phoneinfoga serve` in the lifespan startup
phase. If you see a hang there, check `docker compose logs osint-py`
for "phoneinfoga serve did not become ready" — usually a port
conflict inside the container or a corrupted binary; rebuilding the
image (`docker compose build osint-py`) fixes it.

### Provider returns Failed / weird Final

1. Reproduce against the **sidecar** directly to rule out the
   pipeline:
   ```bash
   curl -s -X POST http://localhost:8000/providers/<id>/run \
     -H 'Content-Type: application/json' \
     -d '<your-body>' | jq
   ```
   If the sidecar returns the expected JSON, the bug is in the Node
   provider / lookup module, not the runner.
2. Re-run with sidecar logs streaming in another terminal:
   `docker compose logs -f osint-py`. Each runner logs `start` /
   `done` / `terminate` / `kill` with the relevant identifiers.
3. For env-conditional providers (truecaller, telegram, ghunt,
   mailcat), the most common failure is `configured: false` — that's
   not a bug, that's the env var being unset. See `docs/OWNER_TODO.md` for
   the one-time setup flow.

### "Provider X expects feature Y but got Z" / schema validation fails

The runner accepts a tolerant shape; the Node side validates with
zod. If the schema rejects a Final, the API turns it into a
`Parse` Failed event. Find the matching `*.types.ts` in
`packages/providers/src/<id>/` — usually one schema field is too
strict for what upstream is actually returning. Relax the constraint
(see e.g. `whatsmyname.types.ts` letting `m_string` / `e_string` be
empty strings rather than `min(1)`).

### Sidecar subprocess hangs

Every runner enforces a wall-clock timeout via `asyncio.timeout(...)`
and falls back to SIGKILL on grace expiry. If you still see a runner
hold a request open: `docker exec echo-osint-py ps -ef` (no pgrep
inside the slim image) to see live children.

### DB / Redis state

```bash
docker compose exec postgres psql -U echo -d echo
docker compose exec redis redis-cli
```

Useful queries:

```sql
-- Recent lookups
SELECT id, provider_id, status, created_at
FROM lookups ORDER BY created_at DESC LIMIT 10;

-- Events for one lookup
SELECT seq, tag, created_at FROM lookup_events
WHERE lookup_id = '<uuid>' ORDER BY seq;
```

### "I changed a .py file but the sidecar still runs the old code"

The Docker image copies `app/` at build time. After editing a runner:

```bash
docker compose up -d --build osint-py
```

Same for TypeScript packages — the `api` / `worker` images bundle
the compiled output. After editing TS, rebuild those services.

## Adding a test target

Default Bruno preset hits `efinswim` / `efinswim@gmail.com` /
`+48537529192`. To switch:

1. Edit `bruno/echo-api/environments/local.bru`.
2. Change `testUsername` / `testEmail` / `testPhone` (and the
   matching `testPhoneCountryDial` / `testPhoneNational` /
   `testPhoneCountryIso` derivatives if you switch country).
3. Every `create-*` / `sidecar-*` request now uses the new target —
   no per-request edits needed.

## Where to look in the codebase

- **API entry points:** `apps/api/src/lookups/lookups.controller.ts`
- **Worker (executes lookups):** `apps/worker/src/lookups/lookups.processor.ts`
- **Provider definitions:** `packages/providers/src/<id>/<id>.ts`
- **Provider shapes:** `packages/providers/src/<id>/<id>.types.ts`
- **Sidecar runners:** `services/echo-osint-py/app/<id>_runner.py`
- **Sidecar routes:** `services/echo-osint-py/app/main.py`
- **Bruno requests:** `bruno/echo-api/{lookups,sidecar}/<id>*.bru`
- **Conformance test:** `packages/providers/src/core/conformance.ts`
- **docs/OWNER_TODO.md**: one-time setup actions for
  env-conditional providers.
