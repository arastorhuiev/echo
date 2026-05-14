# echo — Architecture Brainstorm Overview

> **⚠️ HISTORICAL — Superseded by [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md), [`docs/AGENT_PLAN.md`](../../docs/AGENT_PLAN.md), and [`docs/adr/`](../../docs/adr/).**
>
> This file (and the sibling Plan A / B / C / B-revised drafts) is kept as the brainstorming record so future readers can see *why* we landed where we did. The canonical decisions live under `/docs`.
>
> ---
>
> Source: `PROMPT.md`. Three distinct backend-first plans follow. Pick one (or mix), then we cut a real `ARCHITECTURE.md` and a sprint-zero plan.

## Three plans, at a glance

| Dimension                | **A. Lean MVP**                          | **B. Modular Monolith + Worker Fleet** *(recommended)* | **C. Event-Driven Service Mesh**            |
|--------------------------|------------------------------------------|--------------------------------------------------------|---------------------------------------------|
| Shape                    | Single NestJS app + in-process workers   | NestJS API + separate worker process(es), shared repo | Many small services on a message bus        |
| Queue / async            | BullMQ in-process                        | BullMQ + Redis, dedicated worker deployment            | NATS JetStream / Redis Streams              |
| OSINT integrations       | Direct calls / `child_process` Sherlock  | OSINT "providers" abstracted via Effect-TS interface  | Each provider = its own service container   |
| DB                       | Postgres (Drizzle)                       | Postgres (Drizzle) + Redis cache                      | Postgres + Redis + per-service stores       |
| Real-time progress       | SSE                                      | SSE (WS optional)                                     | WS via gateway, fan-in from event bus       |
| Hosting                  | 1× Hetzner CX (4 GB)                     | 2× Hetzner CCX (api+worker, db) behind Caddy           | Hetzner + k3s or Swarm                      |
| Solo-dev MVP time        | ~2–3 weeks                               | ~4–6 weeks                                            | ~6–10 weeks                                 |
| Adding a new OSINT tool  | Edit code in-place                       | New module + register in provider registry             | Deploy a new container subscribed to topic  |
| Risk profile             | Outgrows itself fast                     | Lowest "wrong moves" risk                             | Premature complexity unless you scale       |
| Frontend                 | Astro + Svelte (Cloudflare Pages)        | Same                                                  | Same                                        |

## Recommendation

**Plan B.** It matches the stack you already chose (NestJS, Drizzle v1, Effect-TS v4), gives you a clean upgrade path to Plan C if you ever need it, and is honest about the fact that *every* OSINT integration brings rate-limit pain, third-party flakiness, and Python interop — none of which monolith-vs-microservices solves on its own.

Plan A is the right call only if you want to ship a working demo *this month* and accept a rewrite later.

Plan C is the right call only if you already know you'll have ≥10 providers in flight, multiple language runtimes, and a teammate to share ops.

## Cross-cutting concerns (apply to all three plans)

These are independent of the architecture choice — flag whichever matter to you.

1. **Legal / compliance**
   - GDPR / Ukrainian data law: OSINT lookups produce personal data even from "public" sources. Consent, retention, and right-to-erasure need a story before you take real users.
   - GetContact specifically has been controversial (Ukrainian SBU concerns, Turkey bans). Verify ToS for redistribution.
   - Sherlock scrapes — many sites' ToS forbid this; you may need proxy rotation and ban-handling.
2. **Stack compatibility caveats**
   - **Effect-TS v4 + NestJS**: there's no official integration. Workable via thin adapters at controller/service edges, but you'll write the bridge yourself. Worth deciding *where* Effect lives (whole app, or just the OSINT provider layer).
   - **Drizzle v1**: GA was late 2025; some plugins (zod codegen, drizzle-kit features) may still lag. Pin versions deliberately.
   - **PostgreSQL vs MySQL**: pick Postgres unless you have a reason. Drizzle, Effect, and the Node ecosystem all lean Postgres-first; LISTEN/NOTIFY also gives you a free pubsub for cheap progress updates.
   - **Cloudflare for backend**: NestJS + Python OSINT tools won't run on Workers. Cloudflare = frontend only. Backend stays on Hetzner / Contabo.
3. **Sherlock interop**
   - Three options: (a) `spawn` Python subprocess per request, (b) long-running Python sidecar with HTTP/gRPC, (c) reimplement in Node. (a) is fine for MVP; (b) is the right answer past ~5 RPS; (c) is a maintenance trap.
4. **Overload protection — the real shape**
   - Per-IP rate limit at edge (Caddy / Cloudflare).
   - Per-user quota at API.
   - Per-provider concurrency cap at the worker (don't let one user's 100-site Sherlock starve another user's GetContact lookup).
   - Circuit breaker per external provider — when GetContact 429s, stop hammering it for N seconds.
   - Queue depth → backpressure: when BullMQ depth > threshold, return `503` with a `Retry-After`.
5. **Caching strategy**
   - Cache OSINT results by `(provider, normalized_query)` with provider-specific TTL (Sherlock: 24h, phone lookups: 7d).
   - Cache stampede protection (single-flight) so 50 concurrent identical queries do one upstream call.
6. **Auth scaffolding (now, implementation later)**
   - Recommend **Better-Auth** or **Lucia v3**: framework-agnostic, plays nicely with Drizzle. Stub `/auth/*` endpoints + a `users` table now; wire the provider later.
7. **Payments scaffolding**
   - Build a `PaymentProvider` interface (`createCheckout`, `verifyWebhook`, `refund`) and stub implementations for Stripe, crypto (NowPayments / BTCPay), Privat24, Monobank, LiqPay. Only Stripe needs a real implementation early; the others stay stubs until a paying user demands one.
8. **Observability from day one**
   - OpenTelemetry SDK in NestJS + workers → Grafana Cloud free tier (or self-hosted Loki/Tempo/Prom on the same VPS).
   - Structured logs (`pino`) with request IDs that flow through to worker jobs.
9. **Testing pyramid**
   - Vitest unit tests on Effect-TS service layer (it's pure-ish — easy wins).
   - Vitest + Testcontainers for repo-layer integration tests (real Postgres, real Redis).
   - Bruno collections committed to repo for manual API exploration.
   - Playwright for the frontend's golden path (one user runs one Sherlock query end-to-end).

## Open questions (please answer before we lock a plan)

These will materially change the recommendation:

1. **Scale target** — first 100 users? 10k? 1M? (Plan A breaks past ~50 concurrent jobs.)
2. **Solo dev or team?** Plan C is dangerous solo.
3. **Budget for infra** — €5/mo Hetzner CX22 vs €40/mo CCX vs k8s elsewhere?
4. **Geography** — EU-only? Includes RU/UA? Affects legal posture and proxy needs.
5. **Authenticated-only or public demo?** Whether unauthenticated users can run lookups changes rate-limiting and abuse story.
6. **Effect-TS commitment level** — is it a "use everywhere" call, or "use in the provider layer where retries/parallelism matter"? I'd recommend the latter; tell me if I'm wrong.
7. **Sherlock realtime feedback** — Sherlock prints found sites as it finds them. You want the frontend to mirror that live. Do you also need a per-site "checking…" indicator (means parsing Sherlock's stdout), or just "found N so far"?
8. **Result graph (future)** — even a stub schema choice now ("entities + edges" vs "documents") affects the DB design.

## Files

- [Plan A — Lean MVP](./echo-plan-a-lean-mvp.md)
- [Plan B — Modular Monolith + Worker Fleet (recommended)](./echo-plan-b-modular-worker-fleet.md)
- [Plan C — Event-Driven Service Mesh](./echo-plan-c-event-driven-services.md)
