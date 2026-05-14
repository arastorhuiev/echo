# Plan A — Lean MVP

> **One sentence:** Single NestJS app, in-process BullMQ workers, Postgres + Redis on one VPS. Ship a working demo in two weekends.

## When this is the right answer

- You want a demo URL within ~2 weeks.
- ≤ 50 concurrent users in the first 6 months.
- You're solo and won't touch ops more than once a week.
- You accept that scaling past ~5 concurrent OSINT jobs will need a small refactor.

## Architecture

```
                         ┌────────────────────────────────┐
                         │     Cloudflare (DNS + CDN)     │
                         └──────────────┬─────────────────┘
                                        │
                ┌───────────────────────┴─────────────────────────┐
                │                                                 │
       Astro + Svelte (Pages)                          Hetzner CX22 (1 VPS)
       - SSG marketing                                 ┌──────────────────────┐
       - Hybrid SSR for app pages                      │  Caddy (TLS, rate    │
       - SSE client for live progress                  │  limit, gzip)        │
                ──────────────► HTTPS ──────────────►  │  ────────┬─────────  │
                                                       │          │           │
                                                       │   NestJS (Fastify)   │
                                                       │   ├─ HTTP API        │
                                                       │   ├─ SSE controller  │
                                                       │   ├─ BullMQ workers  │  ← same process
                                                       │   ├─ Drizzle repos   │
                                                       │   └─ child_process   │
                                                       │      └─► sherlock.py │
                                                       │                      │
                                                       │   Postgres 16        │
                                                       │   Redis 7            │
                                                       └──────────────────────┘
```

## Tech stack

| Layer            | Choice                                     | Why                                                                 |
|------------------|--------------------------------------------|---------------------------------------------------------------------|
| HTTP framework   | NestJS 11 + Fastify adapter                | Fastify is faster, NestJS gives DI/structure                        |
| Async / parallel | Effect-TS v4 (provider layer only)         | Retries, timeouts, cancellation as data — perfect for OSINT         |
| ORM              | Drizzle v1 (Postgres dialect)              | Type-safe, migrations as code                                       |
| DB               | Postgres 16                                | LISTEN/NOTIFY = free progress channel; JSONB for OSINT result blobs |
| Cache / queue    | Redis 7 + BullMQ                           | Battle-tested, in-process workers OK at this scale                  |
| Realtime         | SSE (`@nestjs/platform-fastify` + `Reply`) | Simpler than WebSocket; one-way is what you need                    |
| Sherlock bridge  | `child_process.spawn` per job              | Cheap and obvious; replace later                                    |
| Frontend         | Astro 5 + Svelte 5 (hybrid)                | Per your preference                                                 |
| i18n             | Astro's built-in routing + `paraglide-js`  | Zero-runtime, type-safe message keys                                |
| Lint             | Biome (single tool: lint + format)         | Faster than ESLint+Prettier; one config                             |
| Test             | Vitest + Testcontainers + Playwright       | Per your preference                                                 |
| API explore      | Bruno collections in `/api/bruno`          | Per your preference                                                 |
| Container        | Single `docker-compose.yml`                | API + Postgres + Redis on one box                                   |
| Reverse proxy    | Caddy (auto-TLS)                           | One-liner config, no Certbot dance                                  |
| CI               | GitHub Actions: lint + test + build image  | Push image to GHCR, `docker compose pull && up -d` via SSH          |

## How long-running requests work

1. `POST /api/lookups` validates payload, inserts a `lookups` row (`status=queued`), enqueues a BullMQ job, returns `{ id, sse_url }`.
2. Client opens `GET /api/lookups/:id/stream` (SSE).
3. Worker (same process) picks the job, calls the provider via Effect program with timeouts and retries, emits progress events through Postgres `NOTIFY` → SSE controller pushes them to the client.
4. On completion, worker writes result JSON, marks row `done`, emits final event, client closes.

If the client disconnects mid-job, the job keeps running; reconnecting to the SSE URL replays buffered events from a Redis stream keyed by `lookup_id`.

## Overload protection

- Caddy: per-IP rate limit (e.g., 30 req/min) — enough to stop casual abuse without auth.
- NestJS: per-user quota guard (works even with stub auth = anonymous IP).
- BullMQ: global concurrency = 4 (tune to box size). Per-provider concurrency via separate queues (`q.sherlock`, `q.getcontact`).
- API: when `bullmq.getWaitingCount() > 100`, `POST /api/lookups` returns `503` with `Retry-After: 30`.
- Circuit breaker per external provider (e.g., `cockatiel` lib or hand-rolled with Effect).

## Caching

- `cache:lookup:{provider}:{sha256(query)}` → result JSON, TTL per provider.
- Single-flight via `redis SETNX` so duplicate requests await the in-flight one.
- HTTP-layer ETags on `GET /api/lookups/:id` once `done`.

## Auth & payments scaffolding

- `users` table (id, email, hashed_password nullable, created_at, role).
- `/auth/register`, `/auth/login`, `/auth/me` controllers returning `501 Not Implemented` but with the route shape locked.
- `PaymentProvider` interface and one no-op `stub` implementation; Stripe wiring deferred.
- Webhook routes (`/payments/:provider/webhook`) registered with no-op handlers and a verified-signature middleware stub.

## Hosting

- Hetzner CX22 (€4.51/mo, 4 GB RAM, 2 vCPU, 40 GB SSD) — comfortable for MVP traffic.
- Backups: Hetzner snapshots weekly + nightly `pg_dump` to S3-compatible (Hetzner Object Storage or Backblaze B2).
- DNS + CDN: Cloudflare (free tier).
- Frontend: Cloudflare Pages (free tier).

## Pros

- Smallest possible thing that meets all 9 backend requirements.
- One log file, one deploy command, one mental model.
- Cheap (€5–€10/mo all-in).
- Easy to onboard a future contributor.

## Cons

- Workers compete with API for CPU — a Sherlock burst slows HTTP responses.
- One process means one redeploy interrupts both API and workers.
- No horizontal scale path without surgery.
- Sherlock-via-`spawn` does ~80–150 ms of process-fork overhead per call.

## Migration path → Plan B

When any of these become true, graduate:
- p95 API latency above 500 ms during OSINT bursts → split worker into its own deployment.
- > 50 concurrent jobs → move to dedicated Redis tier and dedicated worker host.
- > 5 OSINT providers → introduce the provider-registry pattern from Plan B.

The migration is mostly mechanical because the code already separates `controllers/` from `workers/`; you just deploy `workers/` as a second container.

## Sprint-zero checklist (first week)

- [ ] Repo skeleton: `pnpm` workspace, `apps/api`, `apps/web`, `packages/db`, `packages/providers`.
- [ ] Drizzle schema: `users`, `lookups`, `lookup_events`, `payments` (stub).
- [ ] One real provider: Sherlock via `spawn`, with Effect program (timeout 60s, 1 retry, abortable).
- [ ] One stub provider: GetContact returning canned data.
- [ ] SSE end-to-end: trigger lookup from a curl, see events stream.
- [ ] Caddyfile + `docker-compose.yml` for prod.
- [ ] GitHub Action: build → push → SSH-deploy.
- [ ] Astro shell with one route that triggers a lookup and renders the SSE stream.
