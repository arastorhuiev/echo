# echo

OSINT aggregator backend. Wraps free OSINT tools (Sherlock, Maigret, etc.) behind a uniform HTTP API with live progress streaming, durable job queueing, and per-provider rate-limit / circuit-breaker protection.

> **Status:** Pre-implementation. Architecture and execution plan are committed; code work begins per [`docs/AGENT_PLAN.md`](./docs/AGENT_PLAN.md).

## Documentation map

| File | What it is |
|---|---|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Canonical system view: components, data flow, deployment shape. Read this first. |
| [`docs/AGENT_PLAN.md`](./docs/AGENT_PLAN.md) | Phase-by-phase execution plan designed for an executor agent (or human). |
| [`docs/PROVIDERS.md`](./docs/PROVIDERS.md) | OSINT provider catalog — what each provider does and where it slots in. |
| [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) | Operational quick reference — how to deploy, debug, recover. |
| [`docs/adr/`](./docs/adr/) | Architecture Decision Records — every load-bearing choice, why, and what was rejected. |
| [`.omc/plans/`](./.omc/plans/) | Brainstorm history (three alternative plans + revisions). Not load-bearing — kept for context. |

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
- **Public deployment** — code is built, tested, and runnable locally only. Production hosting (P11 of [`docs/AGENT_PLAN.md`](./docs/AGENT_PLAN.md)) is **deferred until explicitly activated**.

These are reserved in the schema and acknowledged in [ADR-0012](./docs/adr/0012-no-auth-no-payments-phase1.md); deferred per project direction.

## Repo & secrets hygiene (hard rules)

- **Repo is private.** This GitHub repository must never become public without explicit owner approval.
- **Never commit real secrets.** `.env`, credentials, API keys, certificates, signing keys are gitignored and stay that way. `.env.example` carries placeholder values only.
- **No deployment in the initial plan.** No CI step pushes images, provisions cloud resources, or deploys anywhere until P11 is explicitly activated.
- **Pre-commit checks** for secret leakage land as part of P0 (Biome + a secret scanner).

## Contributing / agent workflow

If you're an executor agent picking up work: start with [`docs/AGENT_PLAN.md`](./docs/AGENT_PLAN.md) — phases are sized for one PR each and have explicit definition-of-done checks.
