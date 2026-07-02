# echo — Backend Roadmap (P8f → P15)

> **Status: `PENDING APPROVAL`.** Proposed sequence produced by a ralplan consensus loop
> (Planner → Architect → Critic → owner decisions → revision → Critic **APPROVE**) on **2026-07-01**.
> Nothing here is executed yet. Owner cadence = **one phase = one branch + one draft PR, owner merges**.
> This document is now the **single source of truth** for the plan. The old phase-by-phase `AGENT_PLAN.md` was retired on 2026-07-02 (stale provider inventory, superseded by this roadmap); its historical build log lives in git history.
>
> Companion docs: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`PROVIDERS.md`](./PROVIDERS.md) · [`RUNBOOK.md`](./RUNBOOK.md) · [`OWNER_TODO.md`](./OWNER_TODO.md)

---

## TL;DR — resume here tomorrow

- **What echo is:** a cheap freemium **person-lookup** OSINT aggregator (email / phone / username → an aggregated report about a person), modeled on but undercutting osint.industries / claritycheck. **Not** domain/company recon.
- **Where we are:** the *engine* is done (P0–P8: 14 providers, SSE streaming, real Redis cache). The *product layers* are not: no guardrails (rate-limit/breaker/single-flight are noop stubs, sidecar has **zero** concurrency caps → a Maigret loop OOMs the box), no aggregation/"search" layer (today 1 lookup = 1 provider), no auth, no payments.
- **What's locked (owner decisions):** payments **last** (a stub keeps results always testable); a **light ops/admin** surface (Bull-Board + `/admin` JSON, no consumer web); providers **free-only** (no paid APIs) pruned to **user-scanner + Hudson Rock**; hosting **CX42 16 GB** with one-command fallback to **CX32 8 GB**; positioning **person-lookup**.
- **First action to pick tomorrow:** **P9b-core stage 2b** (per-provider BullMQ queues + cost counter + cancel-while-queued fix — these touch the api/worker BullMQ wiring and want a worker/queue Testcontainers harness). ✅ **P8f-1** (GHunt + Telegram credential login), ✅ **P9a** (sidecar semaphores + `mem_limit`/`cpus` 16/8 GB profiles), and ✅ **P9b-core wrappers** (`withBreaker` DB-persist + `withRateLimit` + `withSingleFlight`, all unit-tested) are **done and merged to `main`** (2026-07-02).
- **Full working artifacts** from the planning session (free-libs research matrices, the raw plan-v3, the fix-lists) live in the session scratchpad — ask if you want them copied into `docs/research/`.

---

## 0. Context — echo today (verified against code 2026-07-01)

| Layer | State | Notes |
|---|---|---|
| Providers (engine) | 🟢 ~90% | 14 providers: username(6) / phone(5) / email(1=ghunt) / breach(1=hibp) / image(1=exiftool) / meta. Conformance-tested. |
| API + SSE streaming | 🟢 ~85% | `POST /api/lookups`, SSE `GET /:id/stream` (Redis Streams, Last-Event-ID, heartbeat), `DELETE /:id`, `GET /providers`, health, metrics. |
| Cache | 🟢 real | `withCache` (Redis) + `withTracing` active. |
| Guardrails (P9) | 🟡 partial | **All 3 wrappers live** in `apply-wrappers`: `withBreaker` (Redis SM + DB-persist), `withRateLimit` (per-provider), `withSingleFlight` (dedup via Redis lock + pub/sub). Still open: `@nestjs/throttler` not wired; cost-guard / per-provider BullMQ queues / cancel-while-queued = P9b-core s2b + P9-pub. |
| Concurrency | 🟡 partial | **P9a done:** sidecar per-provider + global-heavy `asyncio.Semaphore` (default-deny) + per-container `mem_limit`/`cpus` (16/8 GB profiles). Still one generic BullMQ queue `q.lookup`, worker concurrency **1** (per-provider queues = P9b-core). |
| Frontend | 🔴 ~15% | `apps/web` is a dev console (raw JSON). **Out of scope for now** (owner). |
| Auth / Payments | ⚫ 0% | Zero code. `users` / `payments` / `paid_at` schema exists unused. |
| Deploy (P11) | ⚫ deferred | Until explicit owner go-ahead (hard rule). |

**Bottom line:** strong engine, no product. The gap = guardrails → aggregation → ops surface → auth/stub → (later) payments.

---

## 1. Owner requirements & decisions (locked 2026-07-01)

**The 5 requirements:**
1. **Payments last.** Build a stub now so results are **always testable** end-to-end (a dev bypass gate; `users`/`payments`/`paid_at` schema stays ready but ungated until the final phase).
2. **Light ops/admin surface** — monitoring the backend **+ settings/configs**, not a consumer UI.
3. **Consumer web app out of scope** — `apps/web` stays a dev console. Backend + ops only.
4. **Free-only provider expansion** — owner cannot pay for **any** third-party API. Only free / self-hostable tools.
5. **GHunt login is broken** (cookie/token auth fails) — fix or replace.

**The decisions made during planning:**
| # | Decision |
|---|---|
| **D1 — Hosting** | Primary **Hetzner CX42 (16 GB, ~€17/mo, x86)**; **one-command fallback to CX32 (8 GB, ~€8)** via env memory-profiles (no code change). Self-host Postgres/Redis in compose; Cloudflare free tier. |
| **D2 — Config surface** | Read-only **+ actionable toggles**: view effective (non-secret) config, **enable/disable a provider** (`providers.enabled`), **reset a stuck breaker**. Admin token constant-time compared. |
| **D3 — Admin location** | **Bull-Board + JSON `/admin` API.** No consumer web; `apps/web` untouched. |
| **Providers** | Prune to **user-scanner + Hudson Rock** only (see §2). |
| **Positioning** | **Person-lookup** locked; domain/company-recon axis dropped. |

---

## 2. Providers — the free-only decision

**Add (the ONLY two new providers):**
| Provider | Category | What | Integration | Why |
|---|---|---|---|---|
| **user-scanner** (MIT, pip) | email + username | email → 105+ + username → 185+ registered accounts (incl. free Hudson Rock hits) | Python sidecar runner | **Flagship** email→accounts gap-filler; best-maintained holehe successor (holehe itself is 2022-stale). |
| **Hudson Rock Cavalier** (keyless) | email + phone + username | infostealer-breach intel (account-compromise) by identifier | **Node HTTP** provider (no sidecar), `withCache`+backoff | Zero-cost keyless HTTP; complements the existing HIBP password hashcheck. |

**Cut from the plan** (owner decision — signal over coverage): `holehe`, `blackbird` (dup of existing `whatsmyname`), `Masto` (Fediverse, low signal), `gitrecon`/`gitfive`, `imagehash`, `email-validator`, and the **entire domain cluster** (`subfinder`/`dnsx`/`theHarvester`/`crt.sh`/`Wayback`/`whois`/`webanalyze` — that's domain/infra recon, a different product).

**Categories that stay EMPTY — no free option in 2026 (be honest, return an explicit `unsupported`, never fake):**
- Reverse-image search (Google/Bing/Yandex/TinEye — no free API).
- Open-web reverse-**face** search (PimEyes / FaceCheck — paid).
- Email → **breach list** (HIBP-account / Dehashed / LeakCheck / Snusbase — all paid; only free breach signals = existing HIBP password hashcheck + Hudson Rock infostealer intel).
- **Domain / company recon** — intentionally dropped (not our product).

**Fragile providers — keep but NEVER a core paid promise** (disposable creds ban at ~100–200/day): `ghunt`, `truecaller` (ToS-violating), `telegram-resolve`, `ignorant`. Sandboxed, cost-capped, env-conditional; absence returns a clean `configured:false`.

**GHunt fix (req #5):** no free successor exists. Switch auth from pasted cookies → **burner-account master token** (`aas_et…`/`oauth_token`) driven **via subprocess/stdin/pexpect** (NEVER import GHunt — AGPL boundary). Spike-gated in P8f-1; if the spike fails, fall back to documented manual re-mint and treat GHunt as best-effort.

---

## 3. Hosting & memory budget (D1)

Per-container `mem_limit`s (compose interpolates `${*_MEM_LIMIT}` from the active profile env file), summing **under** the box budget with headroom. Every safety DoD cites a concrete peak-RSS number the load test asserts (no vague "box ceiling").

| Container | 16 GB profile (CX42, **default**) | 8 GB profile (CX32, fallback) |
|---|---|---|
| `postgres` | 1.5g | 1.0g |
| `redis` | 768m | 512m |
| `api` | 768m | 512m |
| `worker` | 1.0g | 768m |
| `osint-py` | **6.0g** | **3.0g** |
| **Σ limits** | ≈10.0 GB (~6 GB host headroom) | ≈5.75 GB (~2.25 GB host headroom) |

**Concurrency knobs (per profile env file; the single source of truth for both the sidecar semaphore and BullMQ caps):**
| Knob | 16 GB | 8 GB |
|---|---|---|
| `MAIGRET_MAX_CONCURRENCY` | 2 | 1 |
| `GLOBAL_HEAVY_CONCURRENCY` | 3 | 1 |
| `MAILCAT_ENABLED` (Chromium ~600 MB) | true | **false** |

**Load-test assertions (replace all "box ceiling" DoDs):** 16 GB → peak `osint-py` RSS **< 5.5 GB**, total **< 11 GB**, **0 OOMKills**. 8 GB → **< 2.8 GB** / **< 6.2 GB** / 0 OOMKills.

**One-command 16→8 GB rollback:** profiles at `deploy/profiles/cx42-16g.env` (default) + `deploy/profiles/cx32-8g.env`; compose reads the active one via `--env-file`. Rollback = a file swap, not a code change (documented in `RUNBOOK.md`).

---

## 4. Roadmap — execution order

Execution order ≠ numeric label order (P10/P11 keep their historical numbers; deploy + real payments are intentionally last).

| # | Label | Phase | Size | Depends on | Req |
|---|---|---|---|---|---|
| ✅ | **P8f-1** | GHunt + Telegram credential login (mint inside sidecar) — *done, merged* | S | — | #5 |
| ✅ | **P9a** | Sidecar per-provider semaphore (default-deny) + mem_limits/cpus (both profiles) — *done, merged* | S | — | #2, D1 |
| 🟡 | **P9b-core** | **wrappers done, merged:** `withBreaker` (DB-persist) + `withRateLimit` + `withSingleFlight`. **s2b pending:** per-provider BullMQ queues + cost counter + cancel-while-queued | M | P9a | #2 |
| 4 | **P13** | Ops cockpit: Bull-Board (own auth) + `/admin` JSON + D2 config toggles + queue/RSS | S–M | P9b-core | #2, D2, D3 |
| 5 | **P8f-2** | Providers (lean): **user-scanner + Hudson Rock** | S | P9a, P9b-core | #4 |
| 6 | **P12** | Search orchestration (`searches` table + cascade-cancel) | M–L | P9b-core, P8f-2, P13 | #1 |
| 7 | **P14** | Entitlement gate (public entrypoints only) + payment **STUB** (bypass open) | S–M | P12 | #1 |
| 8 | **P10** | Observability polish | S | P9b-core, P12, P13 | #2 |
| 9 | **P9-pub** | Public hardening (per-IP throttle, backpressure, cost-cap enforce, Turnstile) — pre-deploy | M | P9b-core | #2 |
| 10 | **P11** | Deployment (incl. 16→8 GB rollback doc) | — | ALL | *(DEFERRED)* |
| 11 | **P15** | Real payments (**LAST**) | M | P14, P11 | #1 |

```
P8f-1 ─ (independent; gates GHunt only)
P9a → P9b-core → P13 ─────────────┐
                 └→ P8f-2 ─────────┤
P8f-2 ───────────────────────────→ P12 → P14
P13 ──────────────────────────────┘  (cockpit precedes fan-out)
{P9b-core, P12, P13} → P10
P9b-core → P9-pub → P11 → P15
```

**Why this order (ADR summary):** the only real failure today is self-inflicted OOM, so a *minimum* safety slice (P9a) comes first and unblocks everything; the ops cockpit (P13) lands **before** orchestration so the fan-out is observable the first time it runs; the payment seam is wired early but **open** so testing never blocks; exposure-only hardening (P9-pub) waits until just before deploy because it earns nothing on an un-exposed box.

---

## 5. Phases in detail

### P8f-1 · GHunt master-token fix (spike-gated) — `req #5`
**Goal:** make the one broken provider reliably loginnable via a burner-account master token — *prove it before promising it* — and reconcile the roadmap doc.
**Tasks:**
1. **SPIKE (gates the DoD):** prove non-interactive master-token login against `ghunt==2.3.3` **via subprocess/stdin/pexpect only — NEVER import ghunt internals (AGPL-3.0 §13 boundary).** Feed the Android master token (`aas_et…`/`oauth_token`) so GHunt mints `/secrets/.malfrats/ghunt/creds.m` unattended (multilogin regenerates cookies on the fly). **If the spike fails:** documented manual re-mint + mark GHunt best-effort.
2. `services/echo-osint-py/app/ghunt_login.py` (mirrors `telegram_login.py`) implementing the proven flow; env `GHUNT_MASTER_TOKEN`.
3. `ghunt_runner.py` unchanged in shape; confirm `_creds_present()` → `configured:false` with no token.
4. `.env.providers.example`: `GHUNT_MASTER_TOKEN=changeme` (burner only, FRAGILE).
5. Docs: `OWNER_TODO.md` + `RUNBOOK.md` replace cookie-paste with master-token mint; `PROVIDERS.md` GHunt card updated.
6. **Docs consolidation (done 2026-07-02):** retired the phase-by-phase `AGENT_PLAN.md` (stale provider inventory; superseded by this roadmap) and the P8 research scratch (`docs/research/p8-plan.md`); this ROADMAP is now the single plan of record and all cross-doc references were repointed here.
**DoD (spike-conditional):** *if spike passes* → one login command produces `creds.m`; `POST /api/lookups {providerId:"ghunt", query:{email:"…"}}` streams a `Final` with a real profile. *Always* → no token ⇒ clean `configured:false`; `pnpm check` green.
**Verify:** `docker compose run --rm -e HOME=/secrets -e GHUNT_MASTER_TOKEN=… osint-py python -m app.ghunt_login`; Bruno `create-ghunt.bru`.

### P9a · Sidecar concurrency caps + container limits (both profiles) — `req #2, D1`
**Goal:** the trivially-safe safety floor — nothing OOMs during testing on either memory profile.
**Invariant:** the sidecar semaphore is the source of truth for sidecar-backed providers; sizing driven by the one knob (`ProviderDefaults.maxConcurrent` mirrored to env + `GLOBAL_HEAVY_CONCURRENCY`). **Unlisted providers default-DENY** (global heavy semaphore, bound 1 — never unbounded).
**Tasks:**
1. `services/echo-osint-py/app/main.py`: a per-provider `asyncio.Semaphore` registry (values from env; **missing id ⇒ global heavy semaphore bound 1**) + a global heavy `asyncio.Semaphore(GLOBAL_HEAVY_CONCURRENCY)`; `async with` around each heavy `run_*` subprocess spawn. Light in-process routes (phonenumbers, socid) exempt.
2. `docker-compose.yml`: `mem_limit`/`cpus` on all containers via `${*_MEM_LIMIT}`/`${*_CPUS}`; ship `deploy/profiles/cx42-16g.env` (default) + `cx32-8g.env` (§3 numbers); `MAILCAT_ENABLED` gates mailcat on 8 GB.
3. `RUNBOOK.md`: the one-command 16→8 GB rollback.
**DoD:** 5 concurrent Maigret runs ⇒ ≤ `MAIGRET_MAX_CONCURRENCY` subprocesses; an unlisted fake provider bounded to 1; full-catalog fan-out keeps peak `osint-py` RSS **< 5.5 GB (16 GB)** / **< 2.8 GB (8 GB)**, **0 OOMKills**; `docker compose --env-file …/cx32-8g.env config` shows the 8 GB limits. `pnpm check` green.
**Verify:** `pytest services/echo-osint-py`; a script POSTing 5 Maigrets + `docker stats --no-stream`.

### P9b-core · Per-provider queues + wrapper activation + cost counter + cancel fix — `req #2`
> **Status (2026-07-02): all 3 wrappers done + merged.** `withBreaker` (Redis SM + DB-persist via `upsertHealth`), `withRateLimit` (per-provider fixed-window), and `withSingleFlight` (Redis `SET NX PX` lock + pub/sub fan-out) are live in `apply-wrappers` — order tracing → cache → single-flight → breaker → rate-limit → provider — each unit-tested with a fake Redis (injected clock / pub-sub bus). **Stage 2b (pending):** per-provider BullMQ queues + routing (task 1), cost counter (task 5), and the cancel-while-queued fix (task 4) — all touch the api/worker BullMQ wiring; land them together with a worker/queue Testcontainers integration test.
**Goal:** activate the stubbed wrappers, split heavy providers onto their own queues, **persist breaker state to the DB**, and fix the cancel-while-queued race.
**Invariant:** `per-provider BullMQ concurrency ≤ that provider's sidecar semaphore`, and `Σ(BullMQ over sidecar providers) ≤ GLOBAL_HEAVY_CONCURRENCY` — same env knob as P9a.
**Tasks:**
1. **Per-provider queues + routing.** Nest binds one `@Processor` per queue → generate N processor classes from a provider→queue map (or imperative BullMQ `Worker`s) in `apps/worker/src/lookups/lookups.module.ts`; route enqueue by provider via `queueName(providerId)` in `apps/api/src/lookups/lookups.service.ts` (heavy → `q.<id>` capped; light → shared queue, higher concurrency).
2. **`withBreaker` WITH DB-persistence:** Redis failure-count state machine (`failureThreshold=5`, `resetMs=30000`, half-open probe) **+ call `repositories.providers.upsertHealth(...)` on every transition + each success/failure** so `providers.breaker_state/last_success_at/last_failure_at` are always current; add to `apply-wrappers.ts`.
3. **`withSingleFlight`** (Redis `SET NX PX` + pub/sub fan-out) and **`withRateLimit`** (per-provider token bucket, `10/s` scrapers) into `apply-wrappers.ts`.
4. **Cancel-flag fix:** a persisted cancel flag (Redis `lookup:cancelled` set or a `status='cancelled'` pre-check) **checked at the top of `LookupProcessor.process()`** so a job cancelled while `waiting` aborts; `LookupsService.cancel()` calls BullMQ `job.remove()` for still-`waiting` jobs. Pub/sub stays the running-job fast path.
5. **Cost counter (count only):** Redis `cost:<provider>:<YYYYMMDD>` INCR per run; `COST_DAILY_WARN=500` logs a warning (enforcement deferred to P9-pub).
**DoD:** 3 Maigret lookups ⇒ ≤ cap running; breaker opens after **5** induced failures **and writes `providers.breaker_state='open'`** (survives worker restart); single-flight collapses 2 identical in-flight to 1 upstream; a lookup cancelled while `waiting` never runs its provider. `pnpm check` green.
**Verify:** `pnpm -F @echo/providers test`; induced-failure test then `psql -c "select id,breaker_state from providers"`; restart worker, re-check.

### P13 · Ops cockpit (Bull-Board own auth + `/admin` JSON + config toggles) — `req #2, D2, D3`
**Goal:** cheap backend visibility **before** fan-out exists — plus the two actionable D2 toggles. Protected, no consumer UI.
**Tasks:**
0. **SPIKE:** validate `@bull-board/fastify` against the app's pinned `@fastify/static ^9.1.3` + `fastify ^5.3.3`; fallback = mount Bull-Board on a separate Fastify instance/port if peers clash.
1. **Bull-Board** at `/admin/queues` on the raw Fastify instance behind a Fastify **`preHandler`** basic-auth sharing `ADMIN_TOKEN` (a Nest guard can't protect a route mounted outside Nest routing).
2. `apps/api/src/admin/` — `GET /admin/status` (per-queue waiting/active/failed; breaker per provider via `providers.getBreakerState`; cost `cost:*`; recent lookups `N=50`; queue-depth + container RSS; sidecar/DB/Redis health).
3. `GET /admin/config` — effective **non-secret** env (memory profile, knobs, flags like `PAYMENTS_ENABLED`), per-provider `enabled`+breaker+caps.
4. `POST /admin/providers/:id/enabled` — writes `providers.enabled`; `LookupsService.enqueue` gains an `enabled=false ⇒ reject` pre-check (the toggle actually sheds load).
5. `POST /admin/providers/:id/breaker/reset` — resets breaker to `closed` via `upsertHealth`.
6. `ADMIN_TOKEN` in `packages/config/src/env.schema.ts` as **required non-empty**; **constant-time compare**; Nest guard on all `/admin/*` JSON.
**DoD:** `/admin/status` (with token) shows live numbers that change when a lookup runs; `/admin/config` returns effective config; disabling a provider ⇒ its next enqueue is rejected; breaker-reset flips state to `closed`; **without a token both `/admin/queues` and `/admin/status` ⇒ 401**. `pnpm check` green.
**Verify:** `curl -H "Authorization: Bearer $ADMIN_TOKEN" localhost:3000/admin/status | jq`; `curl -so /dev/null -w '%{http_code}' localhost:3000/admin/queues` ⇒ 401.

### P8f-2 · Providers (lean): user-scanner + Hudson Rock — `req #4`
**Goal:** fill the flagship email→accounts gap with the two chosen free tools.
**Tasks:**
1. **user-scanner** (MIT, pip) — sidecar `user_scanner_runner.py` + FastAPI route + semaphore entry, following the maigret/socialscan pattern; `--hudson` on. **Resolver dry-run gate first:** `pip install --dry-run user-scanner` must not move `httpx==0.27.2` (isolate in a separate venv only if it does — expected fine, it's light/httpx-based).
2. **Hudson Rock Cavalier** — **Node HTTP provider** (like `hibp`/`gravatar`, no sidecar) through `withCache`+backoff.
3. Conformance tests, Bruno `create-user-scanner.bru` / `create-hudsonrock.bru`, `/info` + `PROVIDERS.md` cards.
**DoD:** each streams a real `Final` for a known-positive query; `/api/providers` lists both; Hudson Rock cached on repeat; `pip install --dry-run` shows no `httpx` delta. `pnpm check` green.
**Verify:** Bruno requests; `curl -s localhost:3000/api/providers | jq '.[].id'`; `pnpm -F @echo/providers test`.
*(Domain/IP category is intentionally left empty — see §2.)*

### P12 · Search orchestration (`searches` table + cascade-cancel) — `req #1`
**Goal:** one identifier → fan-out to every applicable provider → merge/dedupe/correlate into a single report. Testable via API/Bruno/admin (no UI).
**Tasks:**
1. **Data model:** new `packages/db/src/schema/searches.ts` (id, identifier, kind, status, aggregated `report` jsonb, timestamps) + a nullable `search_id` FK on `lookups` (children stay real per-provider rows, so `provider_id notNull()` holds). **Down-migration note in `RUNBOOK.md`** (Drizzle is forward-only — Principle-5 caveat).
2. `apps/api/src/search/` — `POST /api/search` classifies the identifier (email/username/phone/image; **`domain` ⇒ `unsupported`**), writes a `searches` row, enqueues child lookups via the internal (ungated) enqueue through the P9b-core queues with bounded concurrency.
3. `apps/worker/src/search/` — aggregates child events, merges/dedupes/correlates **by URL/handle**; a failed/fragile child (GHunt down) is a per-provider error, never a whole-run failure.
4. `GET /api/search/:id/stream` over a new `search:events:<id>` Redis key.
5. `DELETE /api/search/:id` — cascade cancel: `job.remove()` for `waiting` children, publish `lookup:cancel:<child>` for running; the P9b-core cancel-flag guarantees a `waiting` child never runs.
6. Bruno `search/create-search.bru` + stream + `delete-search.bru`.
**DoD:** `POST /api/search {identifier:"someuser"}` fans out, streams partials on `search:events:<id>`, ends with a merged deduped report; a down provider ⇒ partial (not failure); `DELETE` while a child is `waiting` ⇒ that child never enters `process()`; fan-out peak RSS under the §3 numbers. `pnpm check` green.

### P14 · Entitlement gate (public entrypoints only) + payment STUB — `req #1`
**Goal:** wire the payment seam early but keep it OPEN so P15 is a config flip; gate **only** public entrypoints so orchestration children never double-gate.
**Tasks:**
1. `apps/api/src/entitlement/` `EntitlementService` + guard on **`POST /api/lookups`** and **`POST /api/search`** — NOT on `LookupsService.enqueue`. Add `enqueueInternal()` (no gate) for P12 children.
2. `PAYMENTS_ENABLED` env (default `false`) ⇒ always-allowed + **explicit `paidAt` write** (`repositories.lookups.markPaid`; `create()` doesn't stamp it today); `=true` ⇒ require a paid entitlement (402 when absent).
3. Read paths against reserved `users`/`payments` schema as no-ops.
**DoD:** default env ⇒ every lookup + search completes with `paidAt` set; `PAYMENTS_ENABLED=true` + no entitlement ⇒ 402 at the two public routes only; a child under a paid parent still runs. `pnpm check` green.

### P10 · Observability polish — `req #2`
OTLP exporter via env; custom spans (provider runs, cache hit/miss, breaker decisions, orchestration parent/child sharing a trace id); Prometheus `echo_provider_runs_total` / `_run_duration_ms` / `echo_queue_waiting|active` / `echo_breaker_state` / `echo_cache_lookups_total` / `echo_cost_*`; optional Grafana JSON. **DoD:** metrics at `/api/metrics`; orchestration trace shows parent+child spans; `/admin/status` reads the same signals.

### P9-pub · Public hardening (pre-deploy, exposure-only) — `req #2`
Only needed right before P11. Global `@nestjs/throttler` (Redis, `10 req/60 s`/IP on `/api/lookups` + `/api/search`); backpressure (queue `waitingCount > QUEUE_BACKPRESSURE_MAX=200` ⇒ 503 `Retry-After`); **cost-cap enforcement** (`cost:*` over `COST_DAILY_CAP=1000` ⇒ 503); Cloudflare Turnstile scaffold (env-off by default). **Breaker persistence is NOT here — it moved to P9b-core.** **DoD:** `10 req/60 s` ⇒ 429; queue `>200` ⇒ 503; cost over cap ⇒ 503; all off/default-safe locally.

### P11 · Deployment — **DEFERRED**
No work until an explicit owner "activate P11". Hard rules stay (private repo, no registry pushes, no cloud provisioning). Target: CX42 (16 GB default) behind Caddy+TLS, with the §3 one-command downsize to CX32 documented. **Gate:** the PII/retention TODO (§7) must close before exposure.

### P15 · Real payments — **LAST**
Only after P11 (or explicit owner go-ahead). Real `PaymentProvider` (Stripe first; crypto optional) → `payments` rows + webhook → entitlement → `paidAt`; set `PAYMENTS_ENABLED=true`; retire the always-true bypass. **DoD:** a test-mode payment grants entitlement and unblocks a lookup; unpaid ⇒ 402.

---

## 6. Cross-cutting

**Guardrails design (the "so nothing breaks" ask):** two composed concurrency controls — the sidecar `asyncio.Semaphore` (source of truth, default-deny) and per-provider BullMQ queue caps, both from one knob (`ProviderDefaults.maxConcurrent` → env) with the invariant `BullMQ ≤ semaphore ≤ GLOBAL_HEAVY`. Plus container `mem_limit`s (§3), DB-persisted breakers, single-flight dedup, per-provider rate-limit, cost counters, and (pre-deploy) per-IP throttle + backpressure.

**Test plan (the 5 failure-modes the review surfaced — each named + phase-assigned):**
- (a) **cancel-while-child-QUEUED** [P12]: cancel parent while child #2 is `waiting`; assert it never enters `process()`.
- (b) **resolver dry-run gate** [P8f-2]: `pip install --dry-run` proposes no `httpx` change; else isolate the tool.
- (c) **semaphore default-deny** [P9a]: an unlisted fake provider is bounded to 1, not unbounded.
- (d) **Bull-Board own auth** [P13]: `/admin/queues` without a token ⇒ 401.
- (e) **two-concurrency invariant** [P9b-core]: `BullMQ concurrency ≤ sidecar semaphore` for every sidecar provider; a mis-set knob fails the test.
Plus: per-provider conformance (existing `conformance.ts`), breaker DB-persist+restore, single-flight collapse, entitlement both branches, and a fan-out load-test that asserts the §3 peak-RSS numbers.

**Pre-mortem (top 3):**
1. *Fan-out OOMs the box* → P9a is a hard dependency before P12; concrete peak-RSS assertions; both profiles.
2. *Cancel to a queued child is dropped, a runaway Maigret keeps scanning* → persisted cancel-flag + `job.remove()` (P9b-core T4, cascaded in P12).
3. *Free tools rot / resolver conflict / GHunt burner dies → silent bad results* → GHunt spike-first; DB-persisted breaker surfaced in the admin cockpit; conformance + canary (fixtures in CI); resolver dry-run gate; empty categories return `unsupported`, never faked.

---

## 7. ADR & open follow-ups

**Decision:** P8f-1 → P9a → P9b-core → P13 → P8f-2 → P12 → P14 → P10 → P9-pub → [P11 deferred] → P15. Split the old monolithic P9 into P9a (safety floor) / P9b-core (core hardening) / P9-pub (exposure-only). Breaker persistence moved forward to P9b-core so the ops cockpit reads real state. Providers pruned to user-scanner + Hudson Rock; positioning = person-lookup.

**Drivers:** (1) OOM on one VPS, parameterized across 16 GB default + 8 GB fallback; (2) owner tests results at every step, payments never block; (3) free-tool fragility/rot incl. the `httpx==0.27.2` resolver constraint.

**Consequences:** three hardening PRs (P9a/P9b-core/P9-pub); a new `searches` table with a manual (forward-only) rollback note; an always-true entitlement branch in prod until P15 (tested both ways); Nest-one-processor-per-queue forces N processor classes / imperative Workers in P9b-core; Bull-Board's out-of-Nest mount forces its own Fastify auth.

**Open follow-ups (non-blocking):**
1. **Positioning sub-fork** — "look up anyone" (GDPR-hotter) vs "check your own footprint" (safer). Decide before P11/P15.
2. **PII/GDPR retention** — `lookups.query` + `ipAddress` store raw emails/phones/IPs (surfaced in `/admin` recent-lookups). Low urgency now (private, single-owner, no deploy) → retention/redaction TODO **gated before P11**.
3. **CI canary realism** — record fixtures/VCR for the new providers; reserve live canaries for a manual lane.
4. **Proxy pool** (`proxy-gw` already scaffolded) — enable when scrape-bans appear (~$5–10/mo starter).
5. **Renumber** phases into one ascending sequence once accepted.

---

## 8. How to start tomorrow

Pick one (first two phases are independent):

- ✅ **`P8f-1` — GHunt/Telegram login** — done, merged 2026-07-02 (interactive burner login stays a manual owner step).
- ✅ **`P9a` — safety floor** — done, merged 2026-07-02 (sidecar semaphores + `mem_limit`/`cpus` profiles; live fan-out RSS load-test still a manual/CI step).
- **`P9b-core` — next.** Per-provider BullMQ queues + activate the breaker (DB-persist) / single-flight / rate-limit wrappers + cost counter + cancel-while-queued fix. Then P13 (ops cockpit).

Each phase = a new branch `phase/<id>-<slug>` + a draft PR, `pnpm check` green at the end, owner merges. Say which one and I'll open the branch and start.
