# 0005. OSINT provider abstraction

**Status:** Accepted
**Date:** 2026-05-14

## Context

`echo` will integrate many OSINT tools: Sherlock, Maigret, Holehe, theHarvester, Subfinder, PhoneInfoga, libphonenumber, dnstwist, IPinfo, and more (see [`PROVIDERS.md`](../PROVIDERS.md)). Each has different inputs, different shapes of streamed progress, different rate-limit profiles, and different failure modes. We need uniform handling of caching, single-flight, concurrency limits, circuit breaking, cancellation, observability, and testing — without repeating boilerplate per provider.

## Decision

Define a single `OsintProvider<Q, R>` interface in `@echo/providers/core/`:

```ts
export interface OsintProvider<Q = unknown, R = unknown> {
  readonly id: string
  readonly category: ProviderCategory
  readonly inputSchema: ZodType<Q>
  readonly outputSchema: ZodType<R>
  readonly defaults: {
    timeoutMs: number
    maxConcurrent: number
    cacheTtlSec: number
    breaker: { failureThreshold: number; resetMs: number }
  }
  run(query: Q, ctx: ProviderRunContext): AsyncIterable<ProviderEvent<R>>
}
```

Cross-cutting behaviour is implemented once as decorators wrapped around every provider:
- `withCache` — query → result by `(id, sha256(canonicalize(q)))`.
- `withSingleFlight` — Redis lock collapses concurrent identical queries into one upstream call.
- `withBreaker` — state persisted in `providers` table.
- `withRateLimit` — token bucket on outbound HttpClient.
- `withTracing` — OpenTelemetry span with `provider.id`, `provider.category`, `lookup.id`.

Every provider is registered in a Nest DI module under `@echo/providers/<id>/`. A registry service (`OsintProviderRegistry`) discovers them and exposes `get(id)`, `list()`, and `getByCategory(cat)`.

A **conformance test factory** (`@echo/providers/core/conformance.ts`) is exported. Every provider must run this test and pass — guarantees input validation, output decoding, cancellation mid-stream, and event sequencing.

## Consequences

**Good:**
- New provider = one folder, ~50–150 lines, one registry registration, one Bruno request.
- Caching, rate limiting, breaker, tracing, and tests are written *once*, not per provider.
- Internal refactors (e.g., changing the cache backend) touch one place.
- The conformance suite catches regressions when we update the wrappers.

**Bad:**
- Up-front cost (~1.5 days, P5) before the second provider exists.
- Forces every integration into the streaming `AsyncIterable<ProviderEvent>` shape, even simple "one shot" providers (they emit `Started` → `Final`).

## Alternatives considered

- **Per-provider Nest modules with no abstraction.** Drift sets in fast — different cache strategies, different retry policies, no uniform tracing. Rejected.
- **Microservice per provider** (Plan C in `.omc/plans/`). Solo overhead too high.
- **Function-shaped providers** (`(Q) => Promise<R>`) — loses streaming progress.

## Triggers to reconsider

- Two or more providers consistently fight the abstraction (e.g., need fundamentally different concurrency models) → split, or extend the interface.
- The conformance suite grows so heavy that adding a provider takes longer than the implementation → trim it.
