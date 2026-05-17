# Agent Execution Plan

> Phase-by-phase plan for building **echo**. Designed so an executor agent (`/oh-my-claudecode:autopilot`, `/oh-my-claudecode:executor`, `/oh-my-claudecode:team`, or a human) can pick up *any* phase cold, complete it, and hand off cleanly.
>
> Companion docs: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (the *what*), [`adr/`](./adr/) (the *why*), [`RUNBOOK.md`](./RUNBOOK.md) (the *how to operate*).

## How to use this document

For the agent picking up work:

1. **Find the next unchecked phase.** Phases are sequential — don't skip.
2. **Re-read the phase's "Goal" and "Inputs" to confirm prerequisites are satisfied.** If they aren't, complete the prior phase first.
3. **Implement the "Tasks" in order.** Don't merge phases.
4. **Run the "Definition of done" checklist.** All items must be green.
5. **Make one commit per phase.** Conventional commit prefix matches the phase ID, e.g. `phase(p3): scaffold NestJS api app`. Reference the phase ID in the PR title.
6. **Update this file**: change `Status: not started` → `Status: done` for the phase you finished and add a one-line "Notes" entry if you discovered something the next phase needs to know.

For the human reviewing:

- Each phase is sized to fit in one PR.
- Each phase ends in a runnable, testable state. There should never be a "broken in the middle" commit.

## Conventions used by every phase

- **Branch naming**: `phase/<phase-id>-<slug>`, e.g. `phase/p3-nest-skeleton`.
- **Commit style**: Conventional commits, scoped to the phase. `phase(p3): bootstrap NestJS app with health module`.
- **Validation**: Every phase ends with `pnpm check` (lint + typecheck + tests) and `docker compose up -d --build && curl <relevant endpoint>` where applicable.
- **No phase is "done" without a passing CI run.**
- **No code outside the scope listed**. If a task seems necessary that isn't in the phase's task list, ask before adding — it usually belongs in a later phase.
- **Code organisation** — every new feature lives in its own folder under `src/<feature>/`, with module/controller/service/types/tests co-located. Tests use `*.test.ts` (unit) or `*.int.test.ts` (integration), placed next to the code they exercise. Shared types are inline by default; promote to `*.types.ts` only when 2+ files in the same folder need them. See [ADR-0013](./adr/0013-code-organization.md).
- **Import paths** — intra-package imports use the `@/*` alias (and `@test/*` for shared test helpers). Cross-package imports use workspace names (`@echo/db`). Relative `.js` suffixes are required for ESM packages — see [ADR-0014](./adr/0014-js-suffixes-in-ts-imports.md).

## Phase status legend

- `not started` — nothing committed
- `in progress` — branch exists, commits started
- `done` — merged to `main`, CI green
- `blocked` — see Notes for reason
- `deferred` — out of initial scope; do not start without explicit owner go-ahead

## Hard rules (every phase, every commit)

These override anything else in this document if there's a conflict. Violating them is a **stop-the-world** issue.

1. **Repo is private.** Never push to a public branch, fork, or visibility-flipped repository. If the repo's visibility is in doubt, stop and ask before pushing.
2. **No real secrets in git, ever.** `.env`, `.env.local`, credentials, API keys, certificates, signing keys, and any file matching `secrets/**`, `*.pem`, `*.key`, `*credentials*` stay gitignored. `.env.example` carries placeholder values only (`changeme`, `xxx`, etc.). Run a secret scan locally before each commit (P0 wires `gitleaks` or equivalent into Biome's pre-commit step).
3. **No deployment in the initial plan.** P11 is `deferred`. Do not provision cloud resources, do not push container images to any registry (public or private), do not configure deploy targets, and do not enable any CI job that would do these things — until owner explicitly activates P11.
4. **Branches push to private remote only.** `git remote -v` should show `arastorhuiev/echo` (private). Pushing to any other remote requires owner approval.
5. **One PR per phase.** Open a draft PR at the start of the phase, mark ready for review when the phase's Definition of Done is green, never self-merge — owner reviews and merges.
6. **No skipping pre-commit hooks** (`--no-verify`) and no skipping CI checks. If a hook fails, fix the cause; don't bypass.

---

## P0 — Workspace bootstrap

**Status:** not started
**Estimated size:** half a day
**Goal:** A pnpm monorepo with TypeScript, Biome, the empty workspace layout, CI green on a no-op test.

### Inputs (must already exist)
- A repo with `main` branch (✓ — we have this).
- `.gitignore` (✓ — committed).
- `README.md` (✓ — committed).

### Tasks
1. `pnpm-workspace.yaml` declaring `apps/*`, `packages/*`, `services/*`.
2. Root `package.json` with scripts: `lint`, `format`, `typecheck`, `test`, `check` (= lint + typecheck + test), `dev`, `build`. Use `pnpm -r` for fan-out.
3. `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `moduleResolution: "Bundler"`, `target: "ES2022"`, `esModuleInterop: true`, `skipLibCheck: true`, `verbatimModuleSyntax: true`. Each package extends this. (TypeScript 6.x — latest as of 2026-05.)
4. `biome.json` (Biome 2.x schema) configured for the monorepo (lint + format, ignores `dist`, `node_modules`, `.pnpm-store`, `coverage`).
5. Empty `packages/contracts/` package with `package.json`, `tsconfig.json`, `src/index.ts` exporting nothing yet — proves the workspace plumbing.
6. `vitest.config.ts` at the root (Vitest 4.x — uses `projects` for the workspace). One trivial test in `packages/contracts/test/sanity.test.ts`.
7. GitHub Actions workflow `.github/workflows/ci.yml`: install pnpm, install deps, run `pnpm check`. Triggers on PR + push to `main`.
8. Update `.vscode/extensions.json` (recommend Biome, ESLint OFF, TypeScript Nightly optional).

### Definition of done
- [ ] `pnpm install` succeeds from a clean clone.
- [ ] `pnpm check` succeeds locally.
- [ ] CI workflow shows green on the merge commit.
- [ ] `pnpm -F @echo/contracts test` reports 1 test passing.

### Notes for next phase
- Confirm Node 24 LTS is the version pinned (`.nvmrc`, `engines.node` in root package.json, CI matrix).

---

## P1 — Containerization

**Status:** not started
**Estimated size:** 1 day
**Goal:** Local `docker compose up` brings up Postgres + Redis + a placeholder API container that responds 200 on `/api/health/live`.

### Inputs
- P0 done.

### Tasks
1. Multi-stage `Dockerfile` at the repo root: builder stage (pnpm install + build) + runtime stage (slim Node 24). Build target chosen by `APP=api|worker`. Image entrypoint runs `node dist/apps/<APP>/main.js`.
2. `docker-compose.yml` with services:
   - `postgres` (postgres:17-alpine, named volume, healthcheck).
   - `redis` (redis:7-alpine, named volume, healthcheck).
   - `api` (built from Dockerfile with `APP=api`, depends on postgres+redis healthchecks).
   - `worker` (built from Dockerfile with `APP=worker`, depends on postgres+redis healthchecks; commented out for P1).
   - `osint-py` (placeholder image — `python:3.13-slim` with a stub FastAPI returning `{ ok: true }`; commented out for P1).
3. `.env.example` listing every env the stack reads. Real `.env` is gitignored (already covered).
4. `Caddyfile` for production TLS (commented in compose; not used locally).
5. `apps/api/src/main.ts` minimal NestJS bootstrap returning `{ status: "live" }` on `GET /api/health/live`. (Real Nest scaffolding lands in P3 — for now, a single hand-rolled endpoint is enough to prove the image builds and runs.)
6. Document `pnpm dev`, `pnpm build`, `docker compose up`, `docker compose down -v` in `README.md`.

### Definition of done
- [ ] `docker compose up --build` completes; `curl http://localhost:3000/api/health/live` returns `{ "status": "live" }` (port 3000 — Caddy is not part of the local stack; production proxy lands in P11).
- [ ] `docker compose down -v` cleans up volumes.
- [ ] Image size is sane (< 350 MB for the Node runtime image).
- [ ] No production secret has a default value in `.env.example` — every secret-shaped value is `changeme` or empty.

### Notes for next phase
- Capture which Postgres extensions we want enabled (none yet) so P2 can document them.

---

## P2 — Database layer

**Status:** not started
**Estimated size:** 1 day
**Goal:** Drizzle schema, generated migrations, repository functions for `lookups` + `lookup_events` + `providers`, and an integration test using Testcontainers.

### Inputs
- P1 done (Postgres reachable from local stack).

### Tasks
1. `packages/db/` package: drizzle, drizzle-kit, postgres-js (or `pg`).
2. `packages/db/src/schema/` files (one per table):
   - `lookups.ts` (per `ARCHITECTURE.md` "Data model").
   - `lookup-events.ts`.
   - `providers.ts`.
   - `users.ts` — empty stub table (id, created_at).
   - `payments.ts` — empty stub table (id, created_at).
3. `drizzle.config.ts` at root pointing at the schema.
4. `packages/db/migrations/` populated by `drizzle-kit generate`.
5. `packages/db/src/client.ts` — exports a `createDbClient(env)` factory.
6. `packages/db/src/repositories/` — narrow functions for the access patterns we know we need: `lookups.create`, `lookups.findById`, `lookups.findByHash`, `lookups.markRunning`, `lookups.markDone`, `lookups.markFailed`, `lookups.markCancelled`, `lookupEvents.append`, `providers.upsertHealth`, `providers.getBreakerState`.
7. Integration test in `packages/db/test/lookups.int.test.ts` using `@testcontainers/postgresql`. Spins up Postgres, runs migrations, exercises repositories.
8. Migration runner script `packages/db/scripts/migrate.ts` that the API entrypoint calls on boot (with a leader-election lock or a one-shot migrate container — start simple: just call it from API boot).

### Definition of done
- [ ] `pnpm -F @echo/db test:int` passes against ephemeral Postgres.
- [ ] `pnpm migrate:dev` applies migrations to local Postgres.
- [ ] No raw SQL in app code outside this package.

### Notes for next phase
- Confirm whether to use `postgres-js` or `pg`. Recommend `postgres-js` (faster, simpler, plays nice with Drizzle).

---

## P3 — NestJS skeleton

**Status:** not started
**Estimated size:** 1 day
**Goal:** A real NestJS application with config, logging, OpenAPI, health module, and metrics — replacing the hand-rolled handler from P1.

### Inputs
- P2 done.

### Tasks
1. `apps/api/` package: NestJS 11 + Fastify adapter (`@nestjs/platform-fastify`).
2. Modules: `AppModule` composing `ConfigModule`, `LoggerModule` (`nestjs-pino`), `HealthModule` (`@nestjs/terminus`), `MetricsModule`, `OpenApiModule`.
3. `@echo/config` package: Zod schema for env (DATABASE_URL, REDIS_URL, NODE_ENV, LOG_LEVEL, OTEL_*, OSINT_PY_URL, etc.). NestJS `ConfigService` typed against it.
4. `@echo/observability` package: pino config (structured JSON, request ID), OpenTelemetry SDK setup (auto-instrument HTTP, Postgres via `pg`, Redis, BullMQ). Exporter configured via env (default: console; production: OTLP).
5. Health endpoints: `/api/health/live` (always 200), `/api/health/ready` (checks DB + Redis + osint-py via @nestjs/terminus).
6. OpenAPI: `@nestjs/swagger` with Zod integration via `nestjs-zod`. Served at `/api/openapi.json` and `/api/docs`.
7. Prometheus metrics endpoint at `/api/metrics` (use `prom-client` + Nest middleware). Allowlist by IP in production (env-controlled).
8. `apps/worker/` package: same `AppModule` composition, but bootstrapped with `NestFactory.createApplicationContext` (no HTTP listener). For now, only registers logger + config; BullMQ wiring lands in P4.

### Definition of done
- [ ] `docker compose up --build api worker` brings both up.
- [ ] `curl /api/health/ready` returns 200 with all sub-checks green.
- [ ] `curl /api/openapi.json` returns a valid OpenAPI 3.1 doc.
- [ ] `curl /api/metrics` returns Prometheus exposition.
- [ ] Logs are JSON, include request ID, and a worker log line shares the same trace ID as the originating API request (after P4 wiring; verify scaffolding is in place now).

### Notes for next phase
- Tracing assertion above is partially deferred to P4. Confirm `OTEL_SERVICE_NAME` differs between api and worker.

---

## P4 — Queue infrastructure

**Status:** not started
**Estimated size:** 1 day
**Goal:** BullMQ wired, one trivial test queue/processor demonstrating job submission from API and consumption in worker.

### Inputs
- P3 done.

### Tasks
1. `@echo/queue` package: thin wrappers around `@nestjs/bullmq`. Exports `forRootBullModule()` and `forFeatureBullModule(name)`.
2. Per-queue config helper: `defaultQueueOptions({ providerId, maxConcurrent })` → returns `{ name: "q." + providerId, defaultJobOptions: { attempts, backoff, removeOnComplete, removeOnFail } }`.
3. Wire BullModule.forRoot in `apps/api/AppModule` and `apps/worker/AppModule`.
4. Trivial demo queue `q.echo` with a processor in `apps/worker/src/processors/echo.processor.ts` that logs the payload and returns it.
5. API endpoint `POST /api/_internal/echo-job` (dev-only, gated by env) that enqueues a job and returns the job ID. Used for manual smoke testing.
6. Dead-letter strategy: on `failed` event after max attempts, append a row to `lookup_events` with `_tag: "Failed"`. (For the demo queue, just log.)
7. Trace context propagation: API attaches OTel trace state to the job options; worker reads it and continues the span.

### Definition of done
- [ ] `curl -XPOST /api/_internal/echo-job -d '{"msg":"hi"}'` enqueues; worker logs the message within 1 s.
- [ ] BullMQ admin UI optional; can `redis-cli LRANGE bull:q.echo:wait 0 -1` to inspect.
- [ ] A trace in the OTel exporter spans both api → worker for the same job.

### Notes for next phase
- Decide naming convention for queues: `q.<providerId>` is the rule. P5 onward must follow it.

---

## P5 — Provider abstraction

**Status:** not started
**Estimated size:** 1.5 days
**Goal:** `OsintProvider` interface, registry, conformance test suite, two stub providers used to drive the rest.

### Inputs
- P4 done.

### Tasks
1. `@echo/providers/core/` source files:
   - `provider.ts` — `OsintProvider`, `ProviderEvent`, `ProviderError`, `ProviderRunContext`.
   - `registry.ts` — `OsintProviderRegistry` Nest module + service that loads all providers via DI (each provider exports a `*ProviderModule`).
   - `defaults.ts` — sensible per-category defaults.
   - `wrappers/` — generic decorators applied around every `run()`:
     - `withCache(provider)` — looks up `cache:result:<id>:<hash>`; on miss runs and stores.
     - `withSingleFlight(provider)` — Redis `SET NX PX` lock; concurrent identical requests await the in-flight one.
     - `withBreaker(provider)` — reads/writes `providers.breaker_state`; short-circuits when open.
     - `withRateLimit(provider)` — token bucket on outbound calls (delegated to HttpClient policies, not here — but `withRateLimit` enforces per-provider RPS).
     - `withTracing(provider)` — wraps `run()` in an OTel span.
   - `conformance.ts` — exported test factory: pass a provider, get a Vitest suite that checks input validation, output decoding, cancellation mid-stream, and event sequencing.
2. `@echo/providers/stub-success/` — emits `Started`, three `Progress`, one `Final`. Used to test the pipeline without external calls.
3. `@echo/providers/stub-fail/` — emits `Started`, then throws to exercise error paths.
4. Wire registry in `apps/worker/AppModule`. Add a generic processor `apps/worker/src/processors/lookup.processor.ts` that resolves the provider by job name (or job data) and runs it.
5. `LookupsService` in a new package or `apps/api/src/lookups/`: `enqueue(providerId, query)` returns the lookup ID and writes the row.
6. `POST /api/lookups` controller calling `LookupsService.enqueue`. Validates payload via the provider's `inputSchema` looked up from registry.
7. `GET /api/providers` returns the registry's metadata.

### Definition of done
- [ ] Conformance test passes for both stub providers.
- [ ] `curl -XPOST /api/lookups -d '{"providerId":"stub-success","query":{}}'` returns `{ id, streamUrl }`.
- [ ] Postgres `lookups` row appears with status moving queued → running → done.
- [ ] Stub-fail run produces an error row + Failed event.

### Notes for next phase
- Make sure cancellation path is exercised in tests — P6 builds on it.

---

## P6 — Real-time streaming

**Status:** not started
**Estimated size:** 1 day
**Goal:** SSE endpoint for live progress with reconnect/replay.

### Inputs
- P5 done.

### Tasks
1. Worker writes each `ProviderEvent` to Redis Streams (`lookup:events:<id>`) in addition to Postgres `lookup_events`. TTL on the stream is 1 h after Final.
2. SSE controller `GET /api/lookups/:id/stream`:
   - Reads `Last-Event-ID` header. If present, replays from that ID; otherwise from earliest.
   - Subscribes (XREAD BLOCK) to the stream; pushes each entry as `data: <json>\n\n`.
   - Closes the connection after a `Final` or `Cancelled` event.
   - Honors client disconnect (no leaked subscriptions).
3. `DELETE /api/lookups/:id` — publishes to `lookup:cancel:<id>`. Worker `lookup.processor.ts` calls `AbortController.abort()` on receipt.
4. Backpressure inside SSE: if a client is slow, drop events past a buffer threshold and send a `_tag: "Lagged"` notice (optional polish).
5. Bruno collection: a request that opens the SSE stream and prints events.
6. Vitest integration test using a real Redis (Testcontainers) that runs the stub provider end-to-end through the API.

### Definition of done
- [ ] `curl -N /api/lookups/<id>/stream` prints events in order.
- [ ] Reconnecting with `Last-Event-ID` resumes without gaps or duplicates.
- [ ] `curl -XDELETE /api/lookups/<id>` halts the run; final event has `_tag: "Cancelled"`.

### Notes for next phase
- Decide the SSE message envelope shape now (e.g., `{ seq, tag, payload }`); P7 will emit real provider events into it.

---

## P7 — First real provider (Sherlock)

**Status:** done (2026-05-15)
**Estimated size:** 1.5 days
**Goal:** A working Python sidecar housing Sherlock; a Node-side `OsintProvider` that calls it; end-to-end test that runs a real username lookup.

### Inputs
- P6 done.

### Tasks
1. `services/echo-osint-py/`:
   - `pyproject.toml` (or `requirements.txt` if simpler) pulling Sherlock + FastAPI + httpx + uvicorn.
   - `Dockerfile` — `python:3.13-slim`, multi-stage if Sherlock has heavy build deps.
   - `app/main.py` — FastAPI app:
     - `GET /info` → `{ providers: [...] }` lists supported tools.
     - `POST /providers/sherlock/run` body `{ username }` returns `text/event-stream` of `{site, status, url}` records.
     - Hard timeout from query param.
   - `app/sherlock_runner.py` — wraps Sherlock's library API, yields per-site results; handles errors; supports cancellation via request disconnect.
   - Add to `docker-compose.yml`.
2. `@echo/providers/sherlock/` Node-side:
   - `inputSchema = z.object({ username: z.string().min(1).max(50) })`.
   - `outputSchema = z.object({ found: z.array(z.object({ site, url })), checked: z.number() })`.
   - `run(query)` opens the sidecar SSE, yields `{ _tag: "Partial", chunk: <site-record> }` per event, accumulates final, emits `{ _tag: "Final", data }`.
   - `defaults: { timeoutMs: 60_000, maxConcurrent: 4, cacheTtlSec: 24*3600, breaker: { failureThreshold: 5, resetMs: 30_000 } }`.
   - Conformance test passes.
3. Wire the provider into the worker's BullMQ via the registry.
4. Update OpenAPI: `/api/providers` now lists `sherlock` with its input/output schemas.
5. Bruno request: `POST /api/lookups { providerId: "sherlock", query: { username: "anthropic" } }` → open the SSE stream → see live results.

### Definition of done
- [ ] Sidecar healthcheck passes; `/info` returns sherlock as a known provider.
- [ ] End-to-end Bruno request streams live `Partial` events and ends with `Final`.
- [ ] Cancellation mid-run aborts the Sherlock subprocess inside the sidecar (no orphan).
- [ ] Cache hit on a repeat lookup with the same username within TTL.

### Notes for next phase
- Capture Sherlock's actual rate-limit posture in `defaults`. If Sherlock is bouncing off site bans, plan proxy support before adding more scraping providers.
- **P7 landing notes (2026-05-15):**
  - Sidecar uses subprocess (`python -u -m sherlock_project`) rather than the library API — gives us clean cancellation (SIGTERM on disconnect, SIGKILL after 3 s grace) at the cost of ~300 ms cold-start per request. Worth revisiting if RPS climbs.
  - `OSINT_PY_URL` is now **required** in the env schema (was optional in P3). The api readiness check no longer has a "skipped" branch.
  - `OsintProviderRegistryModule` gained `forRootAsync` so the api/worker can DI-resolve providers from `ConfigService` (Sherlock needs `OSINT_PY_URL`). M1 will need to consider whether Effect-TS would have made this cleaner or added friction.
  - Bruno collection lives at `bruno/echo-api/` — first phase to ship one. Future provider PRs should add a request per provider under `bruno/echo-api/lookups/`.
  - Proxy posture: deferred to P7a (split out as a discrete prep phase between M1 and P8 so the proxy infra can be reviewed and removed independently of any provider).

---

## M1 — CHECKPOINT: Effect-TS review (between P7 and P8)

**Status:** done (2026-05-17, defer again — see [ADR-0006a](./adr/0006a-effect-ts-review-2026-05-17.md))
**Type:** Milestone / decision checkpoint (not a code-producing phase)
**Goal:** Decide whether to introduce Effect-TS into the provider abstraction *now* (before mass-adding providers in P8), *later*, or *never*. See [ADR-0006](./adr/0006-effect-ts-deferred.md).

### When this fires
After P7 lands (Sherlock working end-to-end through the `OsintProvider` abstraction, with the wrappers `withCache`/`withSingleFlight`/`withBreaker`/`withRateLimit`/`withTracing` actually composed in production code) and **before** P8 begins (which would multiply the cost of changing the abstraction shape later).

### What the agent does
1. **Stop.** Do not start P8 until the owner approves the M1 PR.
2. Open a PR titled `M1: Effect-TS review checkpoint` that contains **only**:
   - A new `docs/adr/0006a-effect-ts-review-<YYYY-MM-DD>.md` summarizing the *actual* repo shape now:
     - Count of provider files; total LOC of `packages/providers/core/wrappers/`.
     - 1–2 concrete pain points encountered (or "none — wrappers compose cleanly so far").
     - Performance / observability surprises, if any.
     - One-paragraph yes/no recommendation, with reasoning.
   - No code changes. No new dependencies. No tests. Just the doc.
3. **Notify the owner.** Do not self-merge. Do not start P8.

### What the owner does
- Reads the actual code in `packages/providers/core/`, `packages/providers/sherlock/`, and the registry composition in `apps/worker/`.
- Decides one of:
  - **Yes — introduce Effect.** ADR-0006 is superseded by 0006a (`Status: Superseded by 0006a`). An extra phase **P5.5** is inserted: "Migrate `OsintProvider` from `AsyncIterable` to `Stream`, swap wrappers to Effect operators, scope to `@echo/providers` only". P8 starts after P5.5 lands.
  - **No — stay plain TS.** ADR-0006 stays Accepted; the M1 PR documents the no-go reasons explicitly; P8 begins.
  - **Defer again.** 0006a records why; M1 re-fires as M2 between P8 and P9 (or wherever the owner decides).

### Why this checkpoint exists (and why "triggers" alone weren't enough)
Per owner request: before any work that would commit the codebase to Effect-TS, the owner wants to *see* the repo in its current shape and decide with the actual code in front of them, not just on paper. M1 enforces that pause.

---

## P7a — Proxy gateway scaffold

**Status:** in progress (branch `phase/p7a-proxy-gateway`)
**Estimated size:** 0.5 day
**Goal:** Stand up an optional outbound forward-proxy service (`proxy-gw`) so scrape-based providers in P8 (Maigret) and beyond can route traffic through a paid residential pool when needed — without coupling any application code to the proxy.

### Why split this out of P8
- Maigret is the first provider that benefits from rotation; making the proxy decision *inside* P8a would couple proxy infra to a specific provider's PR.
- The owner explicitly asked for the proxy module to be removable without surgery on the rest of the app. Splitting it out makes the "easy remove" promise verifiable: P7a's diff is the exact diff a future revert would touch.
- Keeps phase-per-PR cadence: this PR is pure infra (no provider code), P8a's PR adds Maigret (no proxy infra changes).

### Inputs
- M1 done.

### Tasks
1. `docker-compose.yml`:
   - Add `proxy-gw` service using `vimagick/tinyproxy` image, gated by `profiles: ["proxy"]` so it doesn't start by default.
   - Add `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` env wiring on the `osint-py` service with empty defaults via `${VAR:-}`.
   - **Do not** add `depends_on` in either direction.
   - **Do not** put `ENV HTTPS_PROXY=` in the sidecar Dockerfile.
2. `infra/proxy-gw/tinyproxy.conf` — pass-through config (~40 lines) with commented templates for: single upstream provider, multi-provider round-robin, per-host bypass.
3. `infra/proxy-gw/README.md` — the architectural contract: five rules that keep coupling at zero, plus an exact file/line list for "how to remove cleanly".
4. `.env.example` — add the three proxy env vars (empty, with a section header pointing at the README).
5. `docs/RUNBOOK.md` — add a "Proxy gateway" section with two sub-flows: "Enable in 5 minutes (pass-through)" and "Connect an upstream residential provider".
6. `docs/AGENT_PLAN.md` — this entry.

### Definition of done
- [ ] `docker compose config` validates with no proxy-gw env set.
- [ ] `docker compose --profile proxy config` validates with proxy enabled.
- [ ] `docker compose up -d` (no profile) starts the stack without `proxy-gw`; existing Sherlock end-to-end smoke test still passes (the sidecar's `HTTPS_PROXY` env is empty, so behavior is identical to before).
- [ ] `docker compose --profile proxy up -d proxy-gw` brings up tinyproxy and it logs that it's listening on `:8080`.
- [ ] `infra/proxy-gw/README.md` documents the five-rule contract and the clean-removal file/line list.
- [ ] No Python or TypeScript code is added or modified.

### Notes for next phase
- The proxy is **off by default in production too** until the owner opts in by setting `HTTPS_PROXY` in the deployment's secret store and starting the `proxy` compose profile. Caddy/reverse-proxy P11 work does not depend on this.
- Cost preview: $0 in pass-through mode; $5–10/mo for a starter residential provider when scrape-bans start appearing; $100–200/mo at beta-scale (~15k lookups/mo). See `RUNBOOK.md` → "Proxy gateway" for provider links.
- If the project later drops every scrape-based provider, follow the removal checklist in `infra/proxy-gw/README.md` — single revert, zero application-code changes.

---

## P8 — Provider catalog rollout

**Status:** not started
**Estimated size:** 2–3 days (parallelizable)
**Goal:** Phase-1 provider lineup live: Sherlock + ~5–7 more across categories per [`PROVIDERS.md`](./PROVIDERS.md).

### Inputs
- P7 done.
- P7a done (proxy gateway scaffold available for scrape-based providers).
- [`PROVIDERS.md`](./PROVIDERS.md) populated by the research pass.

### Tasks (roughly parallelizable; one branch per provider is fine)

For each chosen provider:

1. If Python-only → add to `services/echo-osint-py/app/`. If Node-native → add as a `@echo/providers/<id>/` package using `@echo/http-clients`.
2. Define `inputSchema` and `outputSchema` carefully — these become public API.
3. Implement `run()`. Lean on `withCache`, `withSingleFlight`, `withBreaker`, `withRateLimit`, `withTracing` decorators.
4. Pass conformance suite.
5. Bruno requests committed.
6. Documented in [`PROVIDERS.md`](./PROVIDERS.md): one paragraph + sample input/output.

Suggested Phase-1 starter set (will be confirmed by `PROVIDERS.md`):
- Username: Sherlock + Maigret
- Email: Holehe + EmailRep (free tier)
- Phone: PhoneInfoga + libphonenumber (Node-native validity check)
- Domain: Subfinder + dnstwist
- Tech fingerprint: Wappalyzer CLI

### Definition of done
- [ ] All chosen providers conformance-test green.
- [ ] All listed in `/api/providers`.
- [ ] All have at least one Bruno request hitting them with real input.
- [ ] No provider is in the catalog without a documented input/output schema.

---

## P9 — Hardening

**Status:** not started
**Estimated size:** 1 day
**Goal:** Per-IP rate limiting, per-provider concurrency caps, breaker state persistence, backpressure, captcha gate (scaffold).

### Inputs
- P8 done.

### Tasks
1. Global `@nestjs/throttler` module backed by Redis: `10 req / 60s / IP` for `/api/lookups`.
2. Per-provider throttler: read `provider.defaults.maxConcurrent` and apply via BullMQ queue concurrency.
3. Persist breaker state to `providers` table on every state transition. Restore on worker boot.
4. Backpressure: middleware on `POST /api/lookups` checks `bullQueue.waitingCount`; if above threshold returns `503 Retry-After: 30`.
5. Cost guard: per-provider daily counter in Redis (`cost:<provider>:<YYYYMMDD>`); env-driven cap; over cap → `503` + log warning.
6. Cloudflare Turnstile scaffolding: env-controlled middleware that requires a `cf-turnstile-response` header on `/api/lookups` when per-IP rate hits 80% of limit. Disabled by default in env.
7. Tests: integration test that fires N requests > limit and asserts 429s; test that opens the breaker and asserts the next request returns 503 immediately.

### Definition of done
- [ ] Tests pass.
- [ ] Manual: a script firing 50 requests in 10 s sees the breaker open and recovers after `resetMs`.
- [ ] Documented in `RUNBOOK.md` how to reset a stuck breaker.

---

## P10 — Observability polish

**Status:** not started
**Estimated size:** 1 day
**Goal:** Production-grade tracing, metrics, and dashboards. Optional but cheap.

### Inputs
- P9 done.

### Tasks
1. OpenTelemetry exporter switched to OTLP via env (`OTEL_EXPORTER_OTLP_ENDPOINT`).
2. Custom spans: provider runs, cache lookups (hit/miss attribute), breaker decisions.
3. Custom Prometheus metrics:
   - `echo_provider_runs_total{provider, outcome}` (counter)
   - `echo_provider_run_duration_ms{provider}` (histogram)
   - `echo_queue_waiting{queue}` / `_active{queue}` (gauges)
   - `echo_breaker_state{provider}` (gauge: 0=closed, 1=half_open, 2=open)
   - `echo_cache_lookups_total{provider, outcome}` (counter)
4. Optional: Grafana Cloud free-tier setup; one dashboard JSON committed to `ops/grafana/echo.json`.

### Definition of done
- [ ] Metrics visible at `/api/metrics`.
- [ ] When OTLP endpoint is set, traces show in the receiver.
- [ ] Dashboard JSON renders without missing-metric warnings.

---

## P11 — Deployment **(DEFERRED — out of initial scope)**

**Status:** deferred
**Estimated size:** 1 day (when activated)
**Goal:** Hetzner CCX13 box live with the stack behind Caddy + TLS; CI/CD pipeline pushes images and deploys on merge.

### Why deferred

Per owner direction: the initial plan deliberately stops short of any public deployment. The goal of P0–P10 is a fully working, fully tested, locally-runnable system. No images are pushed to any registry; no cloud resources are provisioned; no domain or DNS is configured; no CI step is allowed to bypass that.

**Do not start P11 without an explicit owner go-ahead** (a top-level instruction like "activate P11" or "let's deploy"). When that arrives, also re-read [Hard rules](#hard-rules-every-phase-every-commit) — they remain in force.

When P11 is activated, the owner also decides:
- Hosting target (Hetzner CCX13 is the [ADR-0011](./adr/0011-deployment-target.md) recommendation, but worth re-confirming).
- Container registry (GHCR private vs. self-hosted).
- Domain / DNS / TLS approach.
- Backup destination (Backblaze B2 vs. Hetzner Object Storage vs. other).

### Inputs (when activated)
- P10 done.
- Owner has explicitly activated P11.
- A Hetzner account + a provisioned CCX13 server with SSH access (or alternative target confirmed).

### Tasks
1. `ops/terraform/` (optional but recommended) — Terraform module that provisions: 1× CCX13, firewall rules (only :22, :80, :443 from internet; rest internal), Hetzner-managed snapshots.
2. Server setup script `ops/bootstrap.sh` (idempotent): installs Docker, Caddy, configures firewall (ufw), creates the deploy user.
3. Production `docker-compose.prod.yml`: same services as local but with image references to GHCR + production env file.
4. `Caddyfile` for production: TLS for `api.echo.<domain>`, basic IP rate limit, gzip, compression, security headers.
5. GitHub Actions workflow `.github/workflows/deploy.yml`:
   - On merge to `main`: build images, tag with git SHA, push to .
   - Manual approval step.
   - SSH to box: `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d --remove-orphans`.
   - Run migration job: `docker compose -f docker-compose.prod.yml run --rm api node dist/apps/api/scripts/migrate.js`.
   - Smoke test: `curl https://api.echo.<domain>/api/health/ready`.
6. Backup: cron on host runs `pg_dump | gzip | b2 upload` nightly. (Or Hetzner snapshot + `pg_dump` to local volume rotated weekly.)
7. Cloudflare DNS + proxy enabled; origin pulls cert via Caddy ACME.

### Definition of done
- [ ] Public URL responds to `GET /api/health/ready` with 200.
- [ ] OpenAPI doc accessible at `/api/openapi.json`.
- [ ] A Bruno smoke run end-to-end against production passes.
- [ ] First deploy is a no-downtime rollover (compose `up -d` with health-aware restart).
- [ ] `RUNBOOK.md` updated with the actual hostnames, secrets locations, and rollback steps.

---

## After P11

Phase 1 is shipped. Decisions to make next:
- Frontend (Astro+Svelte hybrid was the original preference).
- Auth (Phase 3 trigger).
- Payments (Phase 3 trigger).
- More providers (P8 re-runs as needed).
- Effect-TS reconsideration if [ADR-0006](./adr/0006-effect-ts-deferred.md) triggers fire.

These each get their own AGENT_PLAN entry when scheduled.
