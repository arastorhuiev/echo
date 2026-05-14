# Plan B — Modular Monolith + Worker Fleet *(recommended)*

> **One sentence:** Same NestJS codebase, deployed twice — once as the API, once (or N times) as workers — with a real OSINT provider abstraction in front of Sherlock, GetContact, and everything you'll add later.

## When this is the right answer

- You're serious about adding many OSINT providers over time.
- You expect 100s–1000s of concurrent users within the first year.
- You want a stack that doesn't need a rewrite at the next scale step.
- You're willing to spend ~4–6 weeks on the MVP rather than 2.

This is the recommended starting point. It's still a monolith — just one that's *honest* about which parts run where.

## Architecture

```
                        ┌──────────────────────────────────────┐
                        │   Cloudflare (DNS, CDN, edge cache)  │
                        └──────────────┬───────────────────────┘
                                       │
                          ┌────────────┴────────────┐
                          │                         │
                Astro + Svelte (Pages)        Caddy (TLS, edge rate limit)
                                                    │
                                                    │
                                  ┌─────────────────┴─────────────────┐
                                  │                                   │
                      ┌───────────▼────────────┐         ┌────────────▼───────────┐
                      │    Hetzner CCX13       │         │    Hetzner CCX13       │
                      │  ─────────────────     │         │  ─────────────────     │
                      │   NestJS API (PM2)     │         │   NestJS Worker (PM2)  │
                      │   ├─ HTTP / SSE / WS   │         │   ├─ BullMQ consumers  │
                      │   ├─ AuthN / quotas    │         │   ├─ Effect programs   │
                      │   ├─ Provider registry │         │   ├─ Provider impls    │
                      │   └─ Webhook receivers │         │   └─ Sidecar clients   │
                      └─────────┬──────────────┘         └────────┬──────────┬────┘
                                │                                 │          │
                                │      ┌──────────────────────────┘          │
                                │      │                                     │
                                ▼      ▼                                     ▼
                       ┌────────────────────┐                ┌────────────────────────┐
                       │ Hetzner CCX (DB)   │                │ Sherlock sidecar       │
                       │ Postgres 16        │                │ (Python container, gRPC)│
                       │ Redis 7 (cache+BMQ)│                │ + proxy pool           │
                       └────────────────────┘                └────────────────────────┘
```

## Tech stack

Same as Plan A, plus:

| Addition           | Choice                                  | Why                                                                       |
|--------------------|-----------------------------------------|---------------------------------------------------------------------------|
| Provider abstraction| `OsintProvider` Effect-TS interface    | Uniform retry/timeout/cancel/rate-limit semantics across all integrations |
| Sherlock sidecar   | Python FastAPI in Docker, gRPC or HTTP  | Long-lived process; stream results; pluggable proxy                       |
| Service mesh-lite  | Caddy → API; API → workers via Redis   | No real mesh; just disciplined boundaries                                 |
| Auth library       | Better-Auth (or Lucia v3)               | Drizzle-friendly, framework-agnostic                                      |
| Payments           | Stripe Node SDK + provider-pattern stubs | Real Stripe; rest stubbed behind same interface                          |
| Observability      | OpenTelemetry → Grafana Cloud free      | Traces span API → BullMQ → worker → Sherlock; invaluable for debugging    |
| Migrations         | Drizzle Kit + `drizzle-orm/migrator`    | Run on API boot if leader-elected                                         |
| Schema validation  | Effect `Schema` (preferred) or Zod 4    | Use the same schema for HTTP DTOs, BullMQ payloads, and DB row shapes     |
| Job scheduling     | BullMQ repeat jobs                      | For provider health probes, cache eviction, billing rollups               |

## The OSINT provider abstraction (the load-bearing piece)

```ts
// packages/providers/core.ts
import { Effect, Stream, Schema } from "effect"

export interface OsintProvider<Q, R> {
  readonly id: string                    // "sherlock", "getcontact", ...
  readonly inputSchema: Schema.Schema<Q>
  readonly outputSchema: Schema.Schema<R>
  readonly defaults: {
    timeoutMs: number
    maxConcurrent: number
    cacheTtlSec: number
  }
  run(query: Q): Stream.Stream<ProviderEvent<R>, ProviderError>
}

export type ProviderEvent<R> =
  | { _tag: "Progress"; pct: number; note?: string }
  | { _tag: "PartialResult"; chunk: unknown }      // e.g., one Sherlock site hit
  | { _tag: "FinalResult"; data: R }
```

Each new OSINT tool is a file in `packages/providers/<name>.ts` that exports an `OsintProvider`. The worker resolves a job's `providerId` via a registry, runs `Stream.runForEach` to push events into Postgres / Redis Streams, and handles cancellation if the client disconnects.

This is the *real* answer to "I plan to integrate a wide variety of them" — not microservices, but a clean interface and one place that adds rate limiting, caching, retries, and metrics for every provider you'll ever write.

## Long-running request flow

1. `POST /api/lookups { providerId, query }` → validates with provider's `inputSchema`, single-flight cache check, otherwise enqueues to `q.${providerId}` BullMQ queue, returns `{ id, streamUrl }`.
2. Client opens SSE `GET /api/lookups/:id/stream`. API subscribes to `lookup:${id}` channel on Redis (Streams + consumer groups, so reconnect replays).
3. Worker pulls job, runs the provider's `Stream`, publishes each `ProviderEvent` to Redis Streams. API forwards to SSE.
4. Cancellation: client `DELETE /api/lookups/:id` → API marks row `cancelled` and pushes a `cancel:${id}` notification. Worker observes via Effect interruption and stops the underlying gRPC call to Sherlock.

## Overload protection

- **Edge** (Caddy/Cloudflare): per-IP burst limits.
- **API**: per-user RPS + monthly quota (in Drizzle).
- **Per-provider concurrency**: BullMQ queue concurrency = `provider.defaults.maxConcurrent`. One slow provider can't starve another.
- **Per-provider circuit breaker**: when error rate > X% in N seconds, open the breaker; new requests get `503 + Retry-After` immediately.
- **Backpressure**: if `q.${providerId}.waitingCount > N`, API returns `503` and surfaces "queue full, try again in ~30s" to the UI.
- **Worker health**: BullMQ worker exposes `/healthz` reporting active+waiting counts; if unhealthy, an autoscaling rule (manual or via Hetzner API) spins up another worker box.

## Caching

- L1: in-process LRU (10s TTL) on the API for hot result IDs.
- L2: Redis `cache:result:{providerId}:{sha256(query)}` with provider-defined TTL.
- L3: HTTP `Cache-Control: public, max-age=...` on GET endpoints for completed lookups.
- Stampede control: Redis `SET NX PX` lock; concurrent identical requests subscribe to a `wait:` channel for the in-flight lookup ID.

## Sherlock as a sidecar

```
echo-sherlock-svc/
├─ Dockerfile           # python:3.13-slim
├─ pyproject.toml       # sherlock + fastapi + httpx
└─ app/
   ├─ main.py           # POST /lookup → SSE of {site, status, url}
   └─ proxies.py        # round-robin through proxy list
```

Why a sidecar instead of `spawn`:
- Reuses Python interpreter and library imports (Sherlock cold-start is slow).
- Lets you hot-swap proxy pools without bouncing Node.
- Stream of per-site events maps naturally onto `Stream<ProviderEvent>`.
- Keeps Node process clean (no zombie subprocesses).

## Auth & payments scaffolding

- Drizzle schema: `users`, `sessions`, `oauth_accounts`, `quotas`, `payments`, `subscriptions`, `webhook_events`.
- Better-Auth configured but only email-link login enabled; OAuth providers commented and ready to flip.
- Payments: `PaymentProvider` interface + Stripe implementation + 4 stubs (crypto, Privat24, Monobank, LiqPay). Webhook router lives behind `/payments/:provider/webhook` and dispatches by `:provider`.
- All payment provider modules import their secrets via `@nestjs/config` from env — no hard-coded keys.

## Hosting layout

- 2× Hetzner CCX13 (€16/mo each, 2 vCPU dedicated, 8 GB) — one API, one worker.
- 1× Hetzner CCX13 for Postgres + Redis (with daily snapshots).
- 1× Hetzner CX (€4/mo) for the Sherlock sidecar (Python; can co-locate with worker if budget tight).
- Caddy in front of API box (TLS, basic rate limit, request logging).
- Frontend: Cloudflare Pages.
- Optional: pgBouncer in front of Postgres if connection counts grow.
- All boxes in the same Hetzner private network; only Caddy exposes :443.
- Total: ~€55/mo for a comfortable production setup.

## Observability

- OpenTelemetry SDK in API and worker; traces include the BullMQ job ID and the providerId.
- Logs: `pino` with request IDs propagated into job options so a worker log line links back to the originating HTTP request.
- Grafana Cloud free tier (50 GB logs, 10k metrics) is enough for early production.
- Uptime: Cloudflare health checks + a `/livez` and `/readyz` on each service.

## Pros

- Same codebase, different deployments → minimal friction adding workers.
- The `OsintProvider` interface makes the "many providers" plan real, not aspirational.
- Independently scale API and worker fleets.
- Clean migration path to Plan C if you ever need it (each provider can become its own service).
- Full observability story from day one.

## Cons

- Slower start than Plan A (real abstractions take time to design).
- Two deployments mean two deploy pipelines (small overhead).
- Sherlock sidecar = a second language in production (Python).
- Effect-TS in NestJS controllers feels awkward; expect a small adapter layer (`runPromise(program)` at controller edges).

## Migration path → Plan C

You don't need to. But if a single provider needs its own scaling (e.g., a heavy ML-based one), peel it off:
1. Move that provider's worker code into its own service.
2. Replace its in-process registration with a small client that publishes a job to NATS / Redis Streams.
3. The API doesn't notice — same `OsintProvider` interface.

## Sprint plan (4–6 weeks solo)

**Week 1 — Foundations**
- Monorepo (pnpm workspaces): `apps/api`, `apps/worker`, `apps/web`, `packages/db`, `packages/providers`, `packages/payments`, `packages/auth`, `services/sherlock-svc`.
- Drizzle schema (users, lookups, lookup_events, providers, quotas, payments).
- CI: lint (Biome) + Vitest + Drizzle migrate dry-run + Docker image build.
- Caddyfile + Hetzner provisioning script (Terraform or hand-written).

**Week 2 — Provider plumbing**
- `OsintProvider` interface + registry.
- Sherlock sidecar (Python, FastAPI, gRPC or HTTP/SSE).
- Sherlock provider implementation (Effect Stream).
- GetContact provider stub (canned response, real implementation later).
- BullMQ wiring + per-provider queues.
- End-to-end SSE: trigger from curl → see streamed events.

**Week 3 — API surface + auth scaffold**
- Lookup CRUD endpoints, cancellation, replay-from-stream-position.
- Better-Auth wired; email-link login working in dev.
- Quota middleware (counts against `users.quotas`).
- Caching (single-flight + result cache).

**Week 4 — Frontend MVP**
- Astro shell + Svelte islands.
- Lookup form + live progress (SSE consumer in Svelte).
- i18n (paraglide).
- Auth pages (login, registered, account).

**Week 5 — Payments + Ops**
- Stripe checkout + webhook + subscription state.
- Stub payment routes for the other 4 providers (verified signatures, no business logic).
- OpenTelemetry → Grafana Cloud.
- Backup script (`pg_dump` → B2 nightly).
- Playwright e2e for the golden path.

**Week 6 — Hardening**
- Per-provider circuit breaker.
- Backpressure responses.
- Bruno collection committed.
- README + ARCHITECTURE.md (canonicalized from this file).
- Soft launch.
