# Runbook

> Operational quick reference. Sections are filled in as the corresponding phase of [`AGENT_PLAN.md`](./AGENT_PLAN.md) lands. Phases P0–P7 are implemented; later sections still carry placeholders.

## Local development

### First-time setup
```bash
# Install Node 24 LTS (use nvm or volta)
nvm use            # picks up .nvmrc

# Install pnpm 11
corepack enable
corepack prepare pnpm@11.1.2 --activate

# Install deps (also installs the simple-git-hooks pre-commit shim)
pnpm install

# Bring up the local stack (postgres + redis + api + worker + osint-py)
cp .env.example .env
docker compose up -d --build

# Run migrations (api also auto-migrates on boot)
pnpm -F @echo/db migrate:dev

# Smoke test: enqueue a sherlock lookup and watch the SSE stream
LOOKUP_ID=$(curl -s -X POST http://localhost:3000/api/lookups \
  -H 'Content-Type: application/json' \
  -d '{"providerId":"sherlock","query":{"username":"anthropic"}}' \
  | jq -r .id)
curl -N http://localhost:3000/api/lookups/$LOOKUP_ID/stream
```

### Common commands
- `pnpm check` — lint + typecheck + test (gates the pre-commit hook).
- `pnpm -r build` — build everything via each package's `tsconfig.build.json`.
- `pnpm test` — unit tests across the workspace.
- `pnpm test:int` — integration tests (Testcontainers — Docker must be running).
- `docker compose down -v` — nuke local state (Postgres + Redis volumes deleted).

## Production deployment

*To be populated in P11.* Skeleton:

- **Host:** Hetzner CCX13 (initial), see [ADR-0011](./adr/0011-deployment-target.md).
- **Domain:** `api.echo.<domain>` → Cloudflare proxy → origin via Caddy.
- **Secrets:** `/etc/echo/.env` (root-owned, 600). Never in git.
- **Deploy:** GitHub Actions `deploy.yml` (merge to `main` → manual approve → SSH → `docker compose pull && up -d`).
- **Rollback:** redeploy the previous image tag — `docker compose -f docker-compose.prod.yml pull <previous-sha>` then `up -d --force-recreate`.

## Monitoring & alerts

*To be populated in P10.* Skeleton:

- Metrics endpoint: `https://api.echo.<domain>/api/metrics` (Prometheus exposition; allowlist by IP).
- Traces: OTLP exporter to Grafana Cloud (or self-hosted Tempo).
- Logs: stdout → Docker JSON driver → ship to Loki via Promtail.
- Dashboards: `ops/grafana/echo.json`.
- Alerts to wire (suggested):
  - Any provider's breaker state == open for > 5 min.
  - p95 lookup duration > 30 s for any provider.
  - Daily provider cost counter > threshold.
  - Postgres connections > 80% pool size.
  - Redis memory > 80%.

## Common operations

### Reset a stuck circuit breaker

*To be populated in P9.* Likely:
```bash
# Connect to the API container
docker compose exec api node -e "
  /* call providers repository to reset breaker_state to 'closed' */
"
# Or directly in DB:
psql $DATABASE_URL -c "UPDATE providers SET breaker_state='closed', breaker_opened_at=NULL WHERE id='<provider>';"
```

### Drain the worker for maintenance
*To be populated.*

### Replay a failed lookup
*To be populated.*

### Add a new OSINT provider

Each provider lives in `packages/providers/src/<id>/` with files `<id>.ts`, `<id>.types.ts`, `<id>.module.ts`, `<id>.test.ts`, `index.ts`. If the provider needs a Python tool, add the runner module to `services/echo-osint-py/app/<id>_runner.py` and a FastAPI route in `app/main.py`. Register the provider in both `apps/api/src/app.module.ts` and `apps/worker/src/app.module.ts`. Update `docs/PROVIDERS.md` with a status card and add the env vars (if any) to `.env.providers.example` (provider creds) — infrastructure vars go in `.env.example`. The P8a commits on `phase/p8a-foundation` are good worked examples covering HTTP-fetch, in-process Python, subprocess Python, and Go-binary subprocess patterns.

### Provider credentials (env-conditional providers)

A subset of providers register but stay dormant until env vars are present. Without those env vars the routes return `configured=false` with an instructive error rather than crashing.

#### Telegram MTProto resolve (`telegram-resolve`)

1. **Get the API key** — free at <https://my.telegram.org/apps>. Returns `api_id` (integer) and `api_hash` (hex).
2. **Provision a disposable SIM** — buy a one-shot phone number from a reseller (e.g. 5sim.net or sms-activate.org, ~$0.30 in 2026). Register a fresh Telegram account on that number through any official client.
3. **Capture a session file** — one-time, interactive. Run `python -c "from telethon.sync import TelegramClient; TelegramClient('/tmp/session', <api_id>, '<api_hash>').start()"` on a workstation, enter the SMS code Telegram sends to your disposable SIM. The resulting `/tmp/session.session` file IS the credential.
4. **Move the session file to the server** (chmod 600). The path becomes `TELEGRAM_SESSION_PATH`.
5. **Set env vars** in `.env.providers`:
   ```env
   TELEGRAM_API_ID=12345
   TELEGRAM_API_HASH=abc123def456...
   TELEGRAM_SESSION_PATH=/data/telegram-session.session
   ```
6. **Verify** — `docker compose restart osint-py`, then trigger a lookup. The Final's `configured` flag should be `true`.

Rate-limits: ~100–200 resolves/day per session before `FLOOD_WAIT`. When that becomes a bottleneck, provision more sessions and pool them (separate work item, not P8a).

#### Truecaller (`truecaller`)

1. **Provision a disposable SIM** — same as Telegram step 2 above. Reuse the same SIM if convenient (Truecaller and Telegram don't conflict).
2. **Run the truecallerpy login flow** — interactive. On a workstation with `truecallerpy` installed:
   ```bash
   pip install truecallerpy
   truecallerpy --login
   ```
   Enter your disposable phone number, country code, and the OTP Truecaller sends via SMS. The command prints the `installationId` on success.
3. **Set the env var** in `.env.providers`:
   ```env
   TRUECALLER_INSTALLATION_ID=aXXX-XXXX-XXXX
   ```
4. **Smoke-test** — see [p8-plan REV-3 § 4](./research/p8-plan.md). Trigger one lookup against a known number; if the route returns `error: "truecallerpy error: HTTP 401"` the `installationId` has been invalidated (Truecaller occasionally bans). Re-run the login flow with a fresh SIM.

Rate-limits: empirically ~100–200 lookups/day per `installationId` before bans. Cache aggressively (`cacheTtlSec` is already 6 hours).

### Backup / restore
*To be populated in P11.* `pg_dump` → B2 / Hetzner Object Storage; restore is `pg_restore` into a fresh DB.

## Proxy gateway

Optional outbound forward proxy for scrape-based OSINT providers (Sherlock, Maigret, etc). Disabled by default — read [`infra/proxy-gw/README.md`](../infra/proxy-gw/README.md) first for the architectural contract.

### Enable in 5 minutes (pass-through)

```bash
# 1. Start the gateway alongside the rest of the stack.
docker compose --profile proxy up -d

# 2. Point the sidecar at it.
#    Edit .env and set:
#      HTTPS_PROXY=http://proxy-gw:8080
#      HTTP_PROXY=http://proxy-gw:8080
#    (Leave NO_PROXY at its default to keep localhost direct.)

# 3. Re-create the sidecar so it picks up the new env.
docker compose up -d --force-recreate osint-py

# 4. Verify the sidecar is now routing through the gateway.
docker compose exec osint-py python -c "import os; print('HTTPS_PROXY=', os.environ.get('HTTPS_PROXY'))"
# → HTTPS_PROXY= http://proxy-gw:8080

# 5. Watch traffic flow.
docker compose logs -f proxy-gw
# In another shell, run a Sherlock lookup; you should see tinyproxy CONNECT
# entries for the social sites it probes.
```

In pass-through mode the gateway is just a transparent hop — outgoing requests still leave the host's IP. The point of stage one is verifying the wiring before paying anyone.

### Connect an upstream residential provider

Once you've decided you actually need IP rotation (you're seeing site bans, or you're about to scale up Maigret usage):

1. **Pick a provider.** Cheap end (~$5–10/mo starter): [DataImpulse](https://dataimpulse.com), [IPRoyal](https://iproyal.com). Mid-range (~$50–100/mo): [Smartproxy / Decodo](https://smartproxy.com), [Webshare Residential](https://www.webshare.io). All offer pay-as-you-go and month-to-month — start there, not annual contracts.
2. **Grab your endpoint and credentials.** Provider dashboard gives you something like `gate.smartproxy.com:7000` plus a username and password.
3. **Uncomment the single-upstream block** in [`infra/proxy-gw/tinyproxy.conf`](../infra/proxy-gw/tinyproxy.conf) and paste your real endpoint:
   ```
   upstream http YOUR_USER:YOUR_PASS@gate.smartproxy.com:7000
   ```
4. **Restart the gateway** — sidecar stays up:
   ```bash
   docker compose --profile proxy restart proxy-gw
   ```
5. **Verify** an outbound request egresses from a non-host IP:
   ```bash
   docker compose exec osint-py python -c "import requests; print(requests.get('https://api.ipify.org').text)"
   # → some residential IP from the provider's pool, not your server's IP
   ```

For per-host bypass (e.g., GitHub direct, Instagram through proxy) or multi-provider round-robin, see the commented templates in `tinyproxy.conf` — same uncomment-and-edit pattern.

### Remove the proxy gateway entirely

When you no longer need any scrape-based provider, the proxy infra can be deleted without touching application code. Full procedure is in [`infra/proxy-gw/README.md`](../infra/proxy-gw/README.md#how-to-remove-the-proxy-cleanly) — short list:

- Delete the `proxy-gw:` service block + sidecar `HTTPS_PROXY/HTTP_PROXY/NO_PROXY` env lines in `docker-compose.yml`.
- Delete `infra/proxy-gw/` directory.
- Delete the proxy section in `.env.example`.
- Delete this RUNBOOK section.
- Mark P7a as `superseded` in `docs/AGENT_PLAN.md` (don't delete the entry — historical record).

If you find yourself needing to touch any Python / TypeScript / NestJS code during removal, the architectural contract was violated somewhere earlier — fix that first.

## Incident playbook

*To be populated.* Skeleton:

- **API returning 503s for one provider** → check breaker state, check provider's external dependency status.
- **API returning 503s for all providers** → check Redis health, check BullMQ queue lengths.
- **Worker not consuming jobs** → check worker container is up; check Redis connection; check for stuck active jobs (`bull:q.<id>:active`).
- **Database connection storm** → check pgBouncer / connection pool sizing; restart API.
- **Sherlock sidecar OOM** → restart `osint-py`; investigate which Python tool leaked; consider per-tool memory limits in compose.
- **Sidecar `/health` failing but Python alive** → check `docker compose logs osint-py` for stuck `sherlock_project` child processes; the sidecar SIGKILLs after a 3 s grace window but a wedged event loop can stall that.

## Useful one-liners

```bash
# How many lookups in the last hour?
psql $DATABASE_URL -c "SELECT provider_id, status, COUNT(*) FROM lookups WHERE created_at > NOW()-interval '1 hour' GROUP BY 1,2;"

# Peek at queue lengths (one generic queue today; per-provider queues land in P9)
redis-cli LLEN bull:q.lookup:wait
redis-cli LLEN bull:q.lookup:active

# Inspect the realtime SSE stream for a specific lookup
redis-cli XRANGE lookup:events:<lookup-id> - +

# Tail container logs
docker compose logs -f api worker --tail=200
```

## On-call expectations

Solo project. There is no formal on-call. When the project gets users:
- Set Cloudflare uptime checks → email alerts.
- Set Grafana alerts → Telegram/email.
- Document an escalation path (currently: nobody — fix it yourself).
