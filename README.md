# echo

OSINT aggregator backend. Wraps free OSINT tools (Sherlock, Maigret, etc.) behind a uniform HTTP API with live progress streaming, durable job queueing, and per-provider rate-limit / circuit-breaker protection.

> **Status:** Backend engine implemented (14 providers, SSE streaming, Redis cache). Remaining product layers (guardrails, search orchestration, ops surface, auth, payments) are planned in [`docs/ROADMAP.md`](./docs/ROADMAP.md).

## Documentation map

| File | What it is |
|---|---|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Canonical system view: components, data flow, deployment shape. Read this first. |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Backend roadmap (P8f→P15): current state, phase sequencing, plan of record. |
| [`docs/PROVIDERS.md`](./docs/PROVIDERS.md) | OSINT provider catalog — what each provider does and where it slots in. |
| [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) | Operational quick reference — how to deploy, debug, recover. |
| [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) | Local development guide — running the stack and providers on your machine. |
| [`docs/OWNER_TODO.md`](./docs/OWNER_TODO.md) | One-time owner setup actions (credentials for env-conditional providers). |
| [`docs/adr/`](./docs/adr/) | Architecture Decision Records — every load-bearing choice, why, and what was rejected. |

## Stack at a glance

- **Runtime:** Node.js 24 LTS, TypeScript 6.x
- **Framework:** NestJS 11 + Fastify
- **DB / ORM:** PostgreSQL 17 + Drizzle (drizzle-kit migrations)
- **Cache + queue broker:** Redis 7 + BullMQ
- **Validation:** Zod (via `nestjs-zod`)
- **Logging / metrics / tracing:** `nestjs-pino` + OpenTelemetry SDK
- **Tests:** Vitest 4 + Testcontainers; Bruno for manual API exploration
- **Lint/format:** Biome 2
- **Sidecar:** Python (FastAPI) housing Sherlock and similar Python-only tools
- **Reverse proxy:** Caddy (auto-TLS)
- **Deploy:** Docker Compose on Hetzner CCX (CCX13 → CCX33 path) — DEFERRED
- **Repo:** pnpm 11 workspaces

See [`docs/adr/`](./docs/adr/) for the rationale on each choice.

## Out of scope (Phase 1)

- Authentication
- Payments
- Frontend
- i18n
- Multi-region
- **Public deployment** — code is built, tested, and runnable locally only. Production hosting (P11 of [`docs/ROADMAP.md`](./docs/ROADMAP.md)) is **deferred until explicitly activated**.

These are reserved in the schema and acknowledged in [ADR-0012](./docs/adr/0012-no-auth-no-payments-phase1.md); deferred per project direction.

## Repo & secrets hygiene (hard rules)

- **Repo is private.** This GitHub repository must never become public without explicit owner approval.
- **Never commit real secrets.** `.env`, credentials, API keys, certificates, signing keys are gitignored and stay that way. `.env.example` carries placeholder values only.
- **No deployment in the initial plan.** No CI step pushes images, provisions cloud resources, or deploys anywhere until P11 is explicitly activated.
- **Pre-commit checks** for secret leakage land as part of P0 (Biome + a secret scanner).

## Local development

Prerequisites: Node 24 (use `nvm use` to pick up `.nvmrc`), pnpm 11 (`corepack enable && corepack prepare pnpm@latest --activate`), Docker.

```bash
# Install workspace deps
pnpm install

# Lint, typecheck, and run unit tests (default loop)
pnpm check

# Integration tests (Testcontainers — needs Docker running)
pnpm test:int

# Database migrations (against a running local postgres)
export DATABASE_URL=postgres://echo:changeme@localhost:5432/echo
pnpm migrate:generate    # write a new migration file from the schema
pnpm migrate:dev         # apply pending migrations
pnpm migrate:check       # verify the migrations folder matches the schema

# Build a specific app
pnpm -F @echo/api build

# Bring up the local stack (api + worker + postgres + redis + osint-py)
cp .env.example .env   # only needed for non-default values
docker compose up -d --build

# Verify the API is alive (liveness — process is responsive)
curl http://localhost:3000/api/health/live
# → {"status":"live"}

# Verify readiness (postgres + redis + sidecar reachable)
curl http://localhost:3000/api/health/ready

# Run a real lookup through the pipeline (Sherlock via Python sidecar)
LOOKUP_ID=$(curl -s -X POST http://localhost:3000/api/lookups \
  -H 'Content-Type: application/json' \
  -d '{"providerId":"sherlock","query":{"username":"anthropic"}}' \
  | jq -r .id)
curl -N http://localhost:3000/api/lookups/$LOOKUP_ID/stream
# → SSE frames: Started → Partial (per found site) → Final

# OpenAPI document and Swagger UI
curl http://localhost:3000/api/openapi.json
open http://localhost:3000/api/docs

# Prometheus metrics
curl http://localhost:3000/api/metrics

# Tail logs (api or worker)
docker compose logs -f api
docker compose logs -f worker

# Tear down (deletes the postgres + redis volumes)
docker compose down -v
```

The local stack does **not** include Caddy or any reverse proxy — the API container exposes port 3000 directly on `127.0.0.1`. Production deployment with TLS is deferred (see [P11 in the roadmap](./docs/ROADMAP.md)).

## Contributing / agent workflow

If you're an executor agent picking up work: start with [`docs/ROADMAP.md`](./docs/ROADMAP.md) — phases are sized for one PR each and have explicit definition-of-done checks.
