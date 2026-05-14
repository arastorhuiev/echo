# 0006. Effect-TS deferred

**Status:** Accepted
**Date:** 2026-05-14

## Context

The original PROMPT.md listed Effect-TS v4 as part of the preferred stack, and ANSWERS.md initially said "use Effect aggressively, on dangerous level". A subsequent revision asked to keep NestJS as the clean, readable base for the project and add Effect-TS later only if needed. This ADR captures that final direction so future contributors (and future-us) understand why Effect is absent from a codebase that claimed to want it.

## Decision

**Defer Effect-TS adoption.** Phase 1 will use plain `async/await`, Zod, and class-based services within NestJS. Effect will not be installed, even as a peripheral dependency.

## Consequences

**Good:**
- Smaller learning surface for newcomers and agents.
- No conflict between Effect's `Layer`/`Context` DI and NestJS's `@Injectable` DI.
- Zero risk of half-Effect / half-Promise codebase that's harder to read than either.
- Faster Phase 1 delivery — no time spent on Effect interop scaffolding.

**Bad:**
- Lose Effect's typed-error tracking (`Effect<A, E, R>`); errors stay in plain `try/catch` + custom `Error` subclasses.
- Lose `Stream`, `Layer`, `Schema`, `Cause`, structured concurrency, fiber-aware cancellation.
- Provider concurrency / retry / cancellation logic must be hand-rolled (or imported from utility libs like `cockatiel`, `p-retry`).
- Cross-cutting concerns end up as decorators around the `OsintProvider` interface ([0005](./0005-osint-provider-abstraction.md)) instead of composed Effect operators — slightly less elegant.

## Alternatives considered

- **Adopt Effect now (everywhere).** Best Effect ergonomics, but: (a) DI conflict with Nest, (b) significant up-front complexity, (c) executor-agent unfamiliarity, (d) no clear payoff at Phase 1 scale. Rejected per user preference.
- **Adopt Effect only in `@echo/providers`.** Tempting (provider semantics map well to Effect Stream), but the boundary friction at controller and worker edges (`Effect.runPromise`) leaks into surrounding code. Also rejected for now.

## Reconsideration — explicit checkpoint at M1 (not just trigger-based)

Per owner direction, this ADR is reconsidered **at a specific scheduled checkpoint**, not only when triggers fire. The checkpoint is **M1** in [`AGENT_PLAN.md`](../AGENT_PLAN.md) — between P7 and P8, after the first real provider lives in the abstraction and before mass-adding more providers makes any change expensive.

At M1 the agent stops, opens a `docs/adr/0006a-effect-ts-review-<DATE>.md` draft summarizing the actual repo shape, and the owner decides:

- **Adopt Effect (in `@echo/providers` only)** — ADR-0006 is superseded by 0006a; an inserted phase P5.5 migrates the abstraction to `Stream`.
- **Stay plain TS** — ADR-0006 stays Accepted; 0006a records the no-go reasons.
- **Defer again** — 0006a records why; checkpoint re-fires later (M2, etc.).

## Triggers to reconsider (in addition to the M1 checkpoint)

Outside the M1 checkpoint, re-open this ADR when **any two** of the following become true:

1. **Provider count exceeds ~10**, and per-provider retry/timeout/cancellation coordination becomes painful with the hand-rolled wrappers.
2. **`Stream`-shaped flows multiply** beyond OSINT providers (e.g., enrichment pipelines, real-time analysis), and we keep reinventing async iteration patterns.
3. **The team gains Effect expertise** sufficient to absorb the learning cliff with low risk.
4. **A specific Effect feature solves a real problem**: e.g., `@effect/cluster` for durable workflows when BullMQ becomes a constraint.

## Migration sketch (for future-us)

When triggered:
1. Add `effect` as a dependency in `@echo/providers` only.
2. Refactor `OsintProvider.run` from `AsyncIterable<ProviderEvent>` to `Stream.Stream<ProviderEvent, ProviderError>`.
3. Convert wrappers (`withCache`, `withBreaker`, `withRateLimit`) to Effect operators.
4. Bridge to NestJS at the worker boundary via `Effect.runPromise(program)`.
5. Don't touch controllers or repositories — keep them plain.

That's a peripheral, low-risk introduction. Anything more aggressive (Effect-everywhere) requires a fresh ADR.
