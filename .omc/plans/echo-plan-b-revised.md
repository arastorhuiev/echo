# Plan B (Revised) — Effect-First Backend, Solo Dev, Scale-Ready

> **Status:** Revised after `ANSWERS.md`. Supersedes `echo-plan-b-modular-worker-fleet.md`.
>
> **One sentence:** A pure Effect-TS backend (`@effect/platform-node` HTTP, `@effect/sql-drizzle`, BullMQ workers, Postgres + Redis), structured as a pnpm-workspace monorepo, deployed as one container today and split into API + workers tomorrow when traffic warrants.

## What changed from the original Plan B

| Change                              | Why                                                                                              |
|-------------------------------------|--------------------------------------------------------------------------------------------------|
| **Backend-only scope**              | You said: only backend now, frontend later. Removed Astro/Svelte sections; kept API design.      |
| **Drop NestJS, use `@effect/platform-node`** | "Effect on dangerous level" + NestJS's DI/decorators are duplicative and awkward together. See section below. |
| **Single deployment in Phase 1**    | <100 users solo — Plan A's footprint, Plan B's structure. Splittable later with no rewrite.      |
| **Auth & payments scaffold removed** | You said: skip both for now. We keep `users`/`payments` in the schema as empty tables, no code.  |
| **No legal/compliance section**     | You said: skip; handle at scale-time geo-restriction.                                            |
| **`pnpm` workspaces explicit**      | You said so.                                                                                     |
| **Provider catalog expanded**       | Research agent surveying free OSINT tools; will land in `echo-providers-catalog.md`. Sherlock is one of ~12 starter providers across categories. |
| **API surface — public + abuse-resistant** | Anonymous access in Phase 1 means rate limiting + per-IP quotas + bot detection matter more, not less. |
| **Effect Cluster mentioned, not adopted** | BullMQ is safer for solo at this stage; Effect Cluster noted as the "dangerous Effect" upgrade path. |

---

## The NestJS vs. pure Effect decision (read this first)

You wrote both "NestJS" (`PROMPT.md`) and "Effect-TS aggressively, on dangerous level" (`ANSWERS.md`). I'm calling this conflict out before locking the plan because it's the single biggest architectural choice.

### Why "dangerous Effect" wants you off NestJS

NestJS owns:
- **DI**: `@Injectable`, providers, modules.
- **Lifecycle**: `OnModuleInit`, `OnApplicationBootstrap`.
- **HTTP**: decorators, guards, interceptors, pipes.
- **Validation**: ValidationPipe + class-validator.
- **Errors**: exception filters.

Effect owns the same ground better, *if you commit*:
- **DI** → `Context.Tag` + `Layer`. Compositional, type-tracked, testable via `Layer.provide`. NestJS's DI doesn't track effects in the type system; Effect's does.
- **Lifecycle** → `Layer` acquire/release with `Scope`.
- **HTTP** → `@effect/platform`'s `HttpApi`: declarative, derives OpenAPI for free, integrates with Effect runtime so streaming, retries, interruption "just work".
- **Validation** → `@effect/schema` (or `effect/Schema`). Same schemas serve HTTP, DB, BullMQ payloads, and config.
- **Errors** → `Cause`/`Exit`/typed `Effect<A, E, R>`. Tracks every failure in the type system; no try/catch needed.

Used together, you write a controller twice (NestJS decorator + Effect program) and bridge them with `runPromise` at every edge — losing exactly the type-tracking and composition that makes Effect worth using "aggressively".

### Recommendation

**Pure Effect — drop NestJS.** Use `@effect/platform-node` for HTTP and `@effect/platform`'s `HttpApi` for declarative endpoints. You get OpenAPI generation, full Effect runtime semantics, and one mental model.

### What the alternative would look like

If you decide to keep NestJS anyway (e.g., team familiarity, ecosystem):
- NestJS as the HTTP/DI shell, controllers stay thin.
- All "real work" is an `Effect` program returned by services.
- `runPromise(program.pipe(Effect.provide(AppLayer)))` at every controller method.
- Separate `Layer` graph that mirrors the NestJS module graph.
- Effect Schema **wins** over class-validator (don't use both).

This works, just isn't "dangerous Effect"; it's "NestJS with Effect bolted on". Let me know if you want this version drafted instead — say the word and I'll produce it.

The rest of this document assumes the **pure Effect** path.

---

## Stack (pinned to "latest stable, 2026")

| Concern              | Choice                                       | Notes                                                              |
|----------------------|----------------------------------------------|--------------------------------------------------------------------|
| Runtime              | Node.js 22 LTS                               | Native fetch, stable test runner, perf parity with Bun for our load |
| Package manager      | pnpm 10 (workspaces)                         | Explicit per `ANSWERS.md`                                          |
| Language             | TypeScript 5.7+                              | `strict: true`, `noUncheckedIndexedAccess: true`                   |
| Effect ecosystem     | `effect` v3 (named v4 in your prompt; latest stable line) | `@effect/platform`, `@effect/platform-node`, `@effect/schema`, `@effect/sql`, `@effect/sql-drizzle`, `@effect/opentelemetry` |
| HTTP server          | `@effect/platform-node` `HttpServer` + `HttpApi` | Declarative, derives OpenAPI; under the hood uses Node's built-in HTTP |
| ORM                  | Drizzle ORM (latest)                         | Wrap with `@effect/sql-drizzle` so queries are `Effect`s, transactions compose |
| Database             | PostgreSQL 17                                | LISTEN/NOTIFY for free in-process pubsub; JSONB for OSINT result blobs |
| Cache + queue broker | Redis 7                                      | Cache + BullMQ                                                     |
| Job queue            | BullMQ 5                                     | Durable across restarts; per-provider concurrency caps             |
| Effect ↔ BullMQ      | Tiny adapter that wraps job processors as `Effect`s | ~30 lines; preserves cancellation via `AbortSignal` ↔ `Effect.interrupt` |
| Validation           | `effect/Schema`                              | One source of truth for HTTP DTOs, BullMQ payloads, env config     |
| HTTP client (outbound)| `@effect/platform` `HttpClient`             | Built-in retries, timeouts, response decoders                      |
| Logger               | Effect's `Logger` → JSON                     | Structured; no pino needed                                         |
| Tracing / metrics    | OpenTelemetry via `@effect/opentelemetry`    | Spans wrap `Effect`s automatically; export to Grafana Cloud free tier |
| Test                 | Vitest + `@effect/vitest`                    | `it.effect` for layer-overridden unit tests; Testcontainers for repo tests |
| Lint + format        | Biome                                        | One tool, fast                                                     |
| API explore          | Bruno collections in `apis/bruno/`           | Per your preference                                                |
| Container            | Single Dockerfile, multi-stage               | Same image runs API or worker depending on `APP_ROLE` env          |
| Reverse proxy        | Caddy                                        | Auto-TLS, simple rate limit                                        |
| CI                   | GitHub Actions                               | lint + typecheck + vitest + integration (Testcontainers) + image build |
| Deploy               | `docker compose pull && up -d` over SSH      | Boring, debuggable                                                 |
| Sherlock interop     | Python sidecar (FastAPI, SSE)                | Long-lived process; reused across many Python-only OSINT tools     |

### Why not Bun / Deno
- Bun is faster on cold start but `@effect/platform-node` is the supported target. Don't fight your framework.
- Deno's npm story is fine but adds a third runtime to debug.

### Why Drizzle and not Effect-SQL alone
- Drizzle gives schema-first migrations and a familiar query builder.
- `@effect/sql-drizzle` lets Drizzle queries return `Effect`s with structured error types and a connection pool managed as a `Layer`.
- You get migration tooling, type inference, and Effect-native execution.

---

## Monorepo layout (pnpm workspaces)

```
echo/
├── pnpm-workspace.yaml
├── package.json
├── turbo.json                 # optional, fine to skip while solo
├── tsconfig.base.json
├── biome.json
├── docker-compose.yml         # api + postgres + redis + sherlock-svc + caddy
├── Dockerfile                 # one image for api/worker (role via env)
├── Caddyfile
├── apps/
│   ├── api/                   # @echo/api  — HttpApi, runs HttpServer
│   │   ├── src/
│   │   │   ├── main.ts        # Effect.runFork( server )
│   │   │   ├── routes/
│   │   │   ├── handlers/
│   │   │   └── live.ts        # AppLayer = Live composition
│   │   └── package.json
│   └── worker/                # @echo/worker — BullMQ consumer, same Layers as api
│       ├── src/
│       │   ├── main.ts        # Effect.runFork( workers )
│       │   └── consumers/
│       └── package.json
├── packages/
│   ├── contracts/             # @echo/contracts — Schemas shared by api+worker (HttpApi groups, payloads)
│   ├── db/                    # @echo/db — Drizzle schema, migrations, repository Layers
│   │   ├── schema/
│   │   │   ├── lookups.ts
│   │   │   ├── lookup-events.ts
│   │   │   ├── providers.ts
│   │   │   ├── users.ts       # empty stub
│   │   │   └── payments.ts    # empty stub
│   │   └── migrations/
│   ├── providers/             # @echo/providers — OsintProvider interface + impls
│   │   ├── core/              # Provider interface, registry, common cache/breaker
│   │   ├── sherlock/
│   │   ├── maigret/           # populated from research
│   │   ├── holehe/
│   │   ├── numverify/
│   │   ├── phoneinfoga/
│   │   ├── theharvester/
│   │   ├── subfinder/
│   │   ├── … etc
│   │   └── stub/              # canned data for tests
│   ├── queue/                 # @echo/queue — BullMQ ↔ Effect adapter, queue Layers
│   ├── cache/                 # @echo/cache — Redis cache Layer with single-flight + stampede control
│   ├── http-clients/          # @echo/http-clients — pre-configured HttpClients for each upstream API (with rate limit, retry policies)
│   ├── observability/         # @echo/observability — OTel Layer
│   ├── config/                # @echo/config — env Schema, Config Layer
│   └── testing/               # @echo/testing — Testcontainers helpers, Layer factories
├── services/
│   └── sherlock-svc/          # Python sidecar (Sherlock + Maigret + Holehe — anything Python-only)
│       ├── Dockerfile
│       ├── pyproject.toml
│       └── app/
│           ├── main.py        # FastAPI: /providers/<id>/run → SSE
│           └── proxies.py
├── apis/
│   └── bruno/                 # Bruno collection
└── ops/
    ├── terraform/             # optional, Hetzner provisioning
    └── github-actions/
```

**Notes:**
- One Docker image for `apps/api` and `apps/worker`, role decided by `APP_ROLE` env. Saves a build, simplifies deploy.
- `services/sherlock-svc` is a *batch sidecar* — not one container per Python tool. We co-locate everything Python-only (Sherlock, Maigret, Holehe, PhoneInfoga, theHarvester) in a single FastAPI service to amortize the Python startup cost and the Docker image weight.
- `packages/contracts` is the load-bearing seam — every cross-package boundary uses it.

---

## Architecture — Phase 1 (today)

```
                           Cloudflare (DNS + edge cache)
                                       │
                                       ▼
                      ┌─────────────────────────────────┐
                      │        Hetzner CCX13 (€16/mo)   │
                      │                                 │
                      │   Caddy :443 (TLS, IP RL)       │
                      │        │                        │
                      │        ▼                        │
                      │   echo-api  (Node, Effect)      │
                      │      ├─ HttpApi (REST)          │
                      │      └─ SSE for live progress   │
                      │                                 │
                      │   echo-worker (Node, Effect)    │
                      │      └─ BullMQ consumers        │
                      │                                 │
                      │   echo-sherlock-svc (Python)    │
                      │      └─ FastAPI + many tools    │
                      │                                 │
                      │   Postgres 17                   │
                      │   Redis 7                       │
                      └─────────────────────────────────┘
```

One €16/mo box. `docker compose up`. Done.

## Architecture — Phase 2 (when needed)

Triggers (any of):
- p95 API latency above 400ms during OSINT bursts.
- BullMQ active count consistently above worker concurrency × 0.8.
- > 500 concurrent users.

Action: peel `echo-worker` and `echo-sherlock-svc` to a second box; Postgres + Redis stay where they are or move to a third box. **Zero code change** — same containers, different `docker-compose` files.

## Architecture — Phase 3 (paywall era)

When you flip to "lookup but only sees results after payment":
- Implement `users` + `sessions` (Better-Auth or Lucia).
- Implement `PaymentProvider` interface (Stripe first; crypto/Privat24/Monobank/LiqPay added on demand).
- Add `lookups.user_id` (already nullable in schema) + `lookups.paid_at`.
- Result endpoints check `paid_at`; pre-payment, return only `summary` (count, took, partial preview).
- This is a feature flag flip + ~2 weeks of work, not a re-architecture. The Phase 1 schema is designed to absorb it.

---

## The OSINT provider abstraction

The single most important interface in the codebase. Every new tool implements it; everything else (caching, rate limiting, breaker, metrics, replay) is generic across providers.

```ts
// packages/providers/core/provider.ts
import { Context, Effect, Layer, Schema, Stream } from "effect"

export class ProviderError extends Schema.TaggedError<ProviderError>()(
  "ProviderError",
  {
    providerId: Schema.String,
    kind: Schema.Literal("Timeout", "RateLimited", "Unauthorized", "Banned", "Network", "Parse", "Unknown"),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export type ProviderEvent<R> =
  | { readonly _tag: "Started" }
  | { readonly _tag: "Progress"; readonly pct: number; readonly note?: string }
  | { readonly _tag: "Partial"; readonly chunk: unknown }    // streamed hits (e.g., one Sherlock site found)
  | { readonly _tag: "Final"; readonly data: R }

export interface OsintProvider<Q, R> {
  readonly id: string                              // "sherlock", "holehe", ...
  readonly category: ProviderCategory              // "username" | "email" | "phone" | "domain" | ...
  readonly inputSchema: Schema.Schema<Q>
  readonly outputSchema: Schema.Schema<R>
  readonly defaults: ProviderDefaults              // timeoutMs, maxConcurrent, cacheTtlSec, breakerOpts
  run(query: Q): Stream.Stream<ProviderEvent<R>, ProviderError>
}
```

**What's free for every provider** because we own the interface:
- **Caching** by `(providerId, sha256(canonicalize(query)))` with TTL from `defaults`.
- **Single-flight** so 100 concurrent identical queries do one upstream call.
- **Per-provider concurrency cap** via dedicated BullMQ queue.
- **Per-provider circuit breaker** (open after N consecutive 429/5xx).
- **Rate limiting** (token bucket per provider) on outbound HttpClient.
- **Cancellation** propagated end-to-end via Effect interruption.
- **Tracing** spans tagged with `provider.id` and `provider.category`.
- **Test harness** — `StubProvider` that emits scripted `ProviderEvent`s for unit tests.

**Adding a new provider** = one file in `packages/providers/<id>/`, ~50–150 lines, and one line in the registry. Whether it's Node-native, Python-via-sidecar, or CLI-via-subprocess is hidden behind the `Stream`.

---

## Long-running request flow

```
1.  POST /api/lookups
    body: { providerId, query }
    ──► API:
         - parses with provider.inputSchema
         - canonicalizes query
         - cache.get(cacheKey) ─ hit? return result inline (with cached: true)
         - else: insert lookups row (status=queued, idempotency key from sha256)
         - bull.add('q.<providerId>', { lookupId, query }, { jobId: lookupId })
         - returns 202 { id, streamUrl: "/api/lookups/:id/stream" }

2.  GET /api/lookups/:id/stream         (SSE)
    API: subscribe to redis stream `lookup:events:<id>` (consumer group per connection)
         replay missed events on reconnect via stream history

3.  Worker:
    - bull pulls job
    - resolves provider from registry
    - runs provider.run(query) as Stream
    - for each event: persist to lookup_events (cheap append) + xadd to redis stream
    - on Final: mark lookups.status=done, write result
    - on cancel signal: Effect.interrupt → unwinds Stream cleanly

4.  DELETE /api/lookups/:id
    API publishes cancel signal on `lookup:cancel:<id>` channel.
    Worker observes; the Stream is interrupted; row marked cancelled.
```

**Idempotency:** `POST /api/lookups` accepts an optional `Idempotency-Key`; reposts return the same `id`. Without a key, we fall back to `sha256(providerId + query)` so accidental retries don't double-bill the upstream.

**Reconnection:** SSE clients can pass `Last-Event-ID`; we replay from that point in the Redis Stream.

---

## API surface (Phase 1)

| Endpoint                                 | Purpose                                  |
|------------------------------------------|------------------------------------------|
| `GET  /api/providers`                    | List available providers + their input schemas + categories. Frontend uses this to render the form. |
| `POST /api/lookups`                      | Start a lookup. Returns `{ id, streamUrl, cached? }`. |
| `GET  /api/lookups/:id`                  | Lookup status + result (when done).      |
| `GET  /api/lookups/:id/stream`           | SSE: `Started`, `Progress`, `Partial`, `Final`. |
| `DELETE /api/lookups/:id`                | Cancel a running lookup.                 |
| `GET  /api/health/live`                  | Liveness probe.                          |
| `GET  /api/health/ready`                 | Readiness — checks Postgres + Redis + sidecars. |
| `GET  /api/openapi.json`                 | Auto-generated by `HttpApi`.             |
| `GET  /api/metrics`                      | Prometheus exposition (behind allowlist). |

REST + SSE today. WebSocket later if you actually need bidirectional (e.g., dynamic throttling commands from frontend).

---

## Persistence

Drizzle schema (Phase 1; auth/payment tables stubbed, used in Phase 3):

```ts
// packages/db/schema/lookups.ts (sketch)
export const lookups = pgTable("lookups", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerId: text("provider_id").notNull(),
  queryHash: text("query_hash").notNull(),       // sha256 of canonical query
  query: jsonb("query").$type<unknown>().notNull(),
  status: text("status", { enum: ["queued", "running", "done", "failed", "cancelled"] }).notNull().default("queued"),
  result: jsonb("result").$type<unknown>(),
  errorKind: text("error_kind"),
  errorMessage: text("error_message"),
  ipAddress: text("ip_address"),                 // for rate limiting + abuse tracking
  userId: uuid("user_id"),                       // null in Phase 1; populated in Phase 3
  paidAt: timestamp("paid_at"),                  // null in Phase 1; populated in Phase 3
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
}, (t) => ({
  byHash: index().on(t.providerId, t.queryHash),
  byCreated: index().on(t.createdAt.desc()),
}))

export const lookupEvents = pgTable("lookup_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  lookupId: uuid("lookup_id").notNull().references(() => lookups.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  byLookup: index().on(t.lookupId, t.seq),
}))

export const providers = pgTable("providers", {           // tracks runtime state per provider
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  breakerState: text("breaker_state", { enum: ["closed", "half_open", "open"] }).notNull().default("closed"),
  breakerOpenedAt: timestamp("breaker_opened_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastFailureAt: timestamp("last_failure_at"),
})

// users + payments tables: defined empty for Phase 3.
```

**Why both `lookup_events` (Postgres) and Redis Streams?** Redis is the realtime bus for live SSE consumers (fast, transient). Postgres is the durable history for replay days/weeks later and analytics. Workers write both; SSE reads Redis; `GET /api/lookups/:id` reads Postgres.

---

## Overload protection (matters more without auth)

Anonymous Phase 1 = abuse hardened from day one.

1. **Edge** (Caddy): per-IP burst limit (e.g., 30 req/min) and global RPS ceiling.
2. **Cloudflare**: bot fight mode + IP reputation block list.
3. **API**: per-IP token bucket (Redis-backed), distinct from edge limit; e.g., 10 lookups/hour/IP unauthenticated.
4. **Per-provider concurrency**: BullMQ queue concurrency = `provider.defaults.maxConcurrent`. A user spamming Sherlock can't starve Holehe.
5. **Per-provider circuit breaker**: opens after N consecutive failures; closes after M seconds. State persisted in `providers` table so it survives worker restarts.
6. **Backpressure**: when `q.<providerId>.waitingCount > N`, `POST /api/lookups` returns `503` with `Retry-After`.
7. **Cost guard**: track outbound calls per provider; alert (and optionally disable) when daily count exceeds threshold (protects against external API bills + scraper bans).
8. **Captcha gate**: if per-IP rate exceeded, require Cloudflare Turnstile (free) before next lookup. Phase 1.5 enhancement.

---

## Caching

| Layer | Storage  | TTL                    | Purpose                                       |
|-------|----------|------------------------|-----------------------------------------------|
| L1    | Process  | 10s                    | Hot lookup IDs                                |
| L2    | Redis    | per-provider (1h–7d)   | `cache:result:<providerId>:<queryHash>`       |
| L3    | HTTP     | from Cache-Control     | Completed lookups served via CDN              |
| Lock  | Redis    | 30s                    | Single-flight: `lock:lookup:<queryHash>`      |
| Stream| Redis    | 1h after Final         | `lookup:events:<id>` for SSE replay           |

Single-flight is implemented at the API: cache miss → try `SET NX PX` lock → if won, enqueue + own the slot → if lost, subscribe to `lookup:done:<queryHash>` and resolve when the in-flight one finishes. Stops accidental thundering herds (a tweet linking the demo is the realistic threat).

---

## Observability

- `@effect/opentelemetry` Layer in both `apps/api` and `apps/worker`.
- Spans wrap every `Effect`; provider runs are spans tagged `provider.id`, `provider.category`, `lookup.id`.
- Trace context propagated through BullMQ job options (custom headers field) so an API trace continues into the worker.
- Logs: Effect's structured `Logger` writing JSON to stdout; Docker handles capture; ship to Grafana Cloud Loki (free tier).
- Metrics: Effect `Metric.counter`/`gauge`/`histogram` for queue depths, cache hit ratio, per-provider success rate, breaker state. Exposed at `/api/metrics`.
- Uptime: Cloudflare health checks → `/api/health/ready` every 60s.

---

## Effect Cluster — the "dangerous Effect" upgrade path (note, don't adopt yet)

`@effect/cluster` provides durable workflows, sharded entities, and message-based actor semantics — basically BullMQ + temporal-style workflows, native to Effect, with full type tracking.

For your scale today, BullMQ is the right call (battle-tested, smaller dependency, well-understood ops). When two things become true:
1. You want workflows that span multiple steps with checkpoints (e.g., enrichment pipelines: lookup A → derive B → lookup C).
2. You're comfortable making Effect the *runtime*, not just the library.

…then migrate workers from BullMQ to Effect Cluster. The `OsintProvider` interface is unchanged; only `packages/queue` is rewritten.

---

## Testing strategy

- **Unit (Vitest + `@effect/vitest`)**: every provider has a unit test that runs against a mocked `HttpClient` Layer. Pure Effect = no global mocks needed; just override the Layer.
- **Integration (Vitest + Testcontainers)**: spin up real Postgres + Redis; exercise the BullMQ worker with the `StubProvider`.
- **Provider conformance suite**: a parameterized test that every `OsintProvider` must pass (input schema validates known good/bad payloads, output schema parses canned response, cancellation works mid-stream).
- **Load (k6 or vegeta)**: scripted run against the real API in staging to validate breaker/backpressure behavior.
- **Contract (Bruno)**: hand-curated requests committed; CI runs them against a built image.

---

## CI/CD

GitHub Actions:
1. **lint** — Biome.
2. **typecheck** — `tsc --noEmit` per package.
3. **test:unit** — Vitest, no containers.
4. **test:integration** — Vitest + Testcontainers (Postgres + Redis).
5. **build** — single multi-stage Dockerfile → tag with git SHA → push to GHCR.
6. **deploy** (manual approval): SSH to box, `docker compose pull && docker compose up -d`, run migrations via one-shot job.

---

## Sprint plan (revised, 4 weeks solo, backend-only)

### Week 1 — Foundations
- pnpm monorepo + Biome + tsconfig + Dockerfile + docker-compose.
- `@echo/config` env Schema + Config Layer.
- `@echo/db` Drizzle schema (lookups, lookup_events, providers, users-stub, payments-stub) + first migration.
- `@echo/contracts` package with Lookup schemas.
- `@echo/api` skeleton: `HttpApi` with `/health/*` only, OpenAPI generated, OTel wired.
- `@echo/observability` Layer.
- CI green.

### Week 2 — Provider machinery + first 2 providers
- `@echo/providers/core`: `OsintProvider` interface, registry, `StubProvider`, `Provider conformance test`.
- `@echo/queue`: BullMQ ↔ Effect adapter (`runStreamAsJob`, cancellation), per-provider queue Layers.
- `@echo/cache`: Redis cache Layer with single-flight.
- `@echo/http-clients`: pre-configured `HttpClient` Layers with rate limit + retry + breaker.
- `services/sherlock-svc`: FastAPI scaffold with one endpoint hosting Sherlock (and ready to host Maigret/Holehe later).
- `@echo/providers/sherlock`: real provider impl (calls sidecar, streams events).
- `@echo/providers/numverify`: real provider impl (HttpClient, JSON parse).
- End-to-end smoke: `curl POST /api/lookups` → SSE prints events → row appears in Postgres.

### Week 3 — Provider catalog + abuse control
- Add 4–6 more providers (informed by the research agent: Maigret, Holehe, theHarvester, Subfinder, libphonenumber, dnstwist).
- Per-IP rate limit middleware.
- Per-provider breaker state persisted to Postgres; admin endpoint to reset.
- Backpressure response on saturated queues.
- Cost guard counters per provider.
- Conformance tests passing for all providers.

### Week 4 — Hardening + ship
- Load test (k6) against staging; tune concurrency caps.
- Bruno collection committed.
- README + ARCHITECTURE.md (canonical).
- Operational runbook (where logs are, how to reset breaker, how to add a provider).
- One-page postmortem template (you'll need it).
- Deploy to Hetzner CCX13. Soft launch.

---

## What's intentionally NOT in this plan

- **Frontend** (deferred per your direction).
- **Auth** (deferred; schema reserves the seat).
- **Payments** (deferred; schema reserves the seat).
- **i18n** (frontend concern; backend stays English-API).
- **Multi-region** (deferred; one Hetzner box is enough until it isn't).
- **Effect Cluster** (deferred; BullMQ until scale demands more).
- **k8s** (intentionally avoided — solo dev should not run k8s).
- **gRPC / protobuf** (REST + JSON Schema are enough).

---

## Open decisions before week 1

1. **NestJS vs pure Effect** — confirm pure Effect (this plan's assumption) or ask me to redo with NestJS shell.
2. **VPS choice** — Hetzner CCX13 (€16/mo, 2 vCPU dedicated, 8 GB) vs CX22 (€5/mo, shared, 4 GB). I recommend CCX13 because Sherlock + worker + Postgres + Redis on one box benefits from dedicated CPU.
3. **Where to host the Python sidecar in dev** — same `docker-compose.yml`, separate stack, or run natively for fast iteration? My pick: same compose, with a bind-mount for hot reload.
4. **Migration tool** — Drizzle Kit (recommended) vs raw SQL files. Drizzle Kit has gotten good; recommend it.
5. **Provider priority list** — once the research agent returns the catalog, you pick the first 6–8 to ship in Phase 1.

Tell me your answers (or "go ahead") and I'll start cutting code.

---

## What's coming next

- The research agent is producing `echo-providers-catalog.md` — a categorized survey of free OSINT tools. When it lands, I'll fold the top picks into the Week 2/3 schedule above.
- Once you sign off, I produce: (a) a canonical `ARCHITECTURE.md` distilled from this, (b) the repo skeleton (pnpm workspaces + tsconfig + docker-compose + first migration + first provider), (c) a `RUNBOOK.md`.
