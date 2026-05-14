import type { OsintProvider } from "@/core/provider.js"

/**
 * Circuit breaker: short-circuit when the provider has been failing
 * recently to avoid hammering a hosed upstream. State (`closed` /
 * `half_open` / `open`) is persisted to the `providers` table so it
 * survives worker restarts and is shared across replicas.
 *
 * P5 is a pass-through. Real implementation needs:
 * - DI access to a providers repository (or a wrapped DbClient)
 * - failure counting (Redis counter or in-memory + DB sync)
 * - state-machine transitions (closed -> half_open -> open -> half_open)
 *
 * Lands in P9 (hardening) alongside the rate-limiter and backpressure
 * wiring, since that's the phase where real upstream errors actually
 * happen and breakers earn their keep.
 *
 * TODO(P9): Implement persistent breaker with `@echo/db` providers repo.
 */
export function withBreaker<Q, R>(provider: OsintProvider<Q, R>): OsintProvider<Q, R> {
  return provider
}
