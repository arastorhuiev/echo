# 0006a. Effect-TS review — M1 checkpoint (2026-05-17)

**Status:** Accepted (defer again; [0006](./0006-effect-ts-deferred.md) stays Accepted)
**Date:** 2026-05-17

## Context

M1 is the explicit checkpoint scheduled between P7 and P8 to reconsider [ADR-0006 (Effect-TS deferred)](./0006-effect-ts-deferred.md) with the actual repo in front of the owner — before mass-adding providers in P8 makes any abstraction change expensive.

This ADR records the state of the codebase at M1 and the decision.

## Repo shape at M1

- **Production providers:** 1 (`@echo/providers/sherlock`, 227 LOC + 63 LOC SSE parser).
- **`packages/providers/src/core/wrappers/`:** 184 LOC across 6 files.
- **Wrappers actually composed in production code (`apply-wrappers.ts`):** `withCache` + `withTracing` only.
- **Wrappers still pass-through stubs scheduled for P9:** `withBreaker`, `withRateLimit`, `withSingleFlight` (their real implementations need persistent state in `@echo/db` and don't earn their keep until real upstream failures show up under load).
- **Provider event shape:** `AsyncIterable<ProviderEvent>` where `ProviderEvent = Started | Partial | Final`; errors flow as thrown `ProviderError`.

### Concrete pain points encountered so far

**None.** `apply-wrappers.ts` is 30 lines. The Sherlock `run()` generator reads top-to-bottom: fetch → check status → consume SSE → switch on event kind → yield. Cancellation is one `signal` parameter threaded through `fetchImpl` and the reader loop. The conformance suite is a plain `for await` over the iterable.

### Performance / observability surprises

None attributable to the abstraction. The one observed cost (~300 ms cold-start per Sherlock run from `python -u -m sherlock_project` subprocess spawn) lives in the Python sidecar, not in the TS layer — Effect would not change it.

## Decision

**Defer Effect-TS again.** ADR-0006 stays **Accepted**. No phase P5.5 is inserted. P8 begins immediately after this ADR merges.

## Reasoning

### Owner's reason (primary)

> Over-engineering at this stage.

Effect's payoff is *composed* operators across many flows. With 1 production provider, 30-line composition root, and 3 of 5 planned wrappers still unimplemented, there is nothing yet to compose. Introducing a runtime + new mental model now would buy abstraction headroom we have not earned and cannot evaluate against real load. The lighter path keeps optionality: we can always revisit when there is actual complexity to tame, but we cannot un-spend the migration cost once paid.

### Technical reasons (supporting)

1. **DI conflict with NestJS remains unchanged from [ADR-0006](./0006-effect-ts-deferred.md#consequences).** Effect's `Layer`/`Context` and Nest's `@Injectable` would both want to own provider construction; reconciling them at the worker/api boundary leaks `Effect.runPromise` into surrounding code that has no other reason to know about Effect.
2. **Sample size of 1 provider cannot justify an abstraction shift.** Any pain point we'd cite would be speculative — we've only built one provider in this abstraction. The trigger in ADR-0006 ("provider count exceeds ~10") exists precisely because that's the scale where wrapper coordination starts to hurt.
3. **3 of 5 wrappers are stubs.** The composition story that would most benefit from Effect (`withCache → withSingleFlight → withBreaker → withRateLimit → withTracing` cleanly chaining typed errors) does not exist yet in code — only in module-level comments. Migrating an abstraction before its consumers are written is the wrong order of operations.
4. **Vitest + `AsyncIterable` works natively.** The conformance suite and Sherlock tests use plain `for await`. Moving to `Stream` adds `@effect/vitest` (or `Effect.runPromise` shims in every test), increasing test boilerplate before delivering any test-quality improvement.
5. **Migration would gate P8.** A P5.5 phase rewriting the `OsintProvider` contract from `AsyncIterable` to `Stream`, plus converting the conformance suite, lookup processor, registry, and Sherlock provider, is at minimum 1–2 days of risky refactor with no new user-visible capability — directly blocking the provider catalog rollout that is the actual next deliverable.
6. **Cancellation already works.** The one feature Effect would most cleanly improve (interrupt-aware teardown of fetch + reader) is currently handled by `AbortSignal` threading and a `finally { reader.cancel() }`. It is not elegant, but it is correct and tested, and the worker's `DELETE /api/lookups/:id` end-to-end path is green.

## Triggers to re-fire this checkpoint (M2 or later)

Re-open this decision when **any two** of these become true (same triggers as [ADR-0006](./0006-effect-ts-deferred.md#triggers-to-reconsider-in-addition-to-the-m1-checkpoint), restated here for proximity):

1. Provider count exceeds ~10 and per-provider retry/timeout/cancellation coordination becomes painful with the hand-rolled wrappers.
2. `Stream`-shaped flows multiply beyond OSINT providers (enrichment pipelines, real-time analysis), and we keep reinventing async iteration patterns.
3. The team gains Effect expertise sufficient to absorb the learning cliff with low risk.
4. A specific Effect feature solves a real problem (e.g., `@effect/cluster` for durable workflows when BullMQ becomes a constraint).

The natural next checkpoint **M2** would fire between P8 and P9 — after the provider catalog rollout has produced enough data to evaluate whether wrapper composition actually hurts at scale.

## Consequences

- P8 starts immediately on `main` after this ADR merges; no P5.5 phase is inserted.
- `OsintProvider` interface stays `AsyncIterable<ProviderEvent>`; new providers in P8 follow the Sherlock shape.
- P9 hardening implements the stub wrappers (`withBreaker`, `withRateLimit`, `withSingleFlight`) as plain TS — same `(provider) => provider` shape as `withCache`.
- No Effect dependency enters the lockfile in Phase 1.
