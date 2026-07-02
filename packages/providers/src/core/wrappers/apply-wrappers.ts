import type { Redis } from "ioredis"
import type { OsintProvider } from "@/core/provider.js"
import { type BreakerPersist, withBreaker } from "@/core/wrappers/with-breaker.js"
import { withCache } from "@/core/wrappers/with-cache.js"
import { withRateLimit } from "@/core/wrappers/with-rate-limit.js"
import { withSingleFlight } from "@/core/wrappers/with-single-flight.js"
import { withTracing } from "@/core/wrappers/with-tracing.js"

export interface WrapperDeps {
  /** Shared ioredis client used by cache, breaker, and rate-limiter. */
  readonly redis: Redis
  /**
   * Optional breaker-state sink (P9b-core). The worker wires this to
   * `repositories.providers.upsertHealth` so breaker transitions land in
   * Postgres for the ops cockpit. Omitted → the breaker still runs
   * entirely in Redis, just not mirrored to the DB.
   */
  readonly persistBreaker?: BreakerPersist
}

/**
 * Compose every cross-cutting wrapper around a provider. Order (outermost
 * first) is deliberate:
 *
 *   tracing → cache → single-flight → breaker → rate-limit → provider
 *
 * - tracing outermost: its span covers cache hits + breaker short-circuits.
 * - cache next: a hit returns before touching anything below.
 * - single-flight: collapses concurrent identical queries to one call that
 *   goes through breaker + rate-limit + upstream.
 * - breaker before rate-limit: an open breaker short-circuits without
 *   burning a rate-limit token.
 * - rate-limit innermost: gates only the real upstream call.
 *
 * The composer is THE place to add or reorder wrappers — providers never
 * call them directly.
 */
export function applyWrappers<Q, R>(
  provider: OsintProvider<Q, R>,
  deps: WrapperDeps,
): OsintProvider<Q, R> {
  const rateLimited = withRateLimit(provider, deps.redis)
  const breakered = withBreaker(rateLimited, {
    redis: deps.redis,
    persist: deps.persistBreaker,
  })
  const singleFlighted = withSingleFlight(breakered, deps.redis)
  return withTracing(withCache(singleFlighted, deps.redis))
}
