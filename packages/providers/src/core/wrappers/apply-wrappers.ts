import type { Redis } from "ioredis"
import type { OsintProvider } from "@/core/provider.js"
import { withBreaker } from "@/core/wrappers/with-breaker.js"
import { withCache } from "@/core/wrappers/with-cache.js"
import { withRateLimit } from "@/core/wrappers/with-rate-limit.js"
import { withSingleFlight } from "@/core/wrappers/with-single-flight.js"
import { withTracing } from "@/core/wrappers/with-tracing.js"

export interface WrapperDeps {
  /** Shared ioredis client used by cache + single-flight. */
  readonly redis: Redis
}

/**
 * Compose every cross-cutting wrapper around a provider. Order matters:
 * - Tracing on the OUTSIDE so it observes the wrapped behaviour
 *   (cache hits, breaker short-circuits, etc. all show up in the span).
 * - Cache before single-flight so single-flight only fires for misses.
 * - Single-flight before breaker so the lock isn't taken during a
 *   short-circuit return.
 * - Breaker before rate-limit so a tripped breaker doesn't burn tokens.
 *
 * The composer is THE place to add or reorder wrappers — providers
 * never call them directly.
 */
export function applyWrappers<Q, R>(
  provider: OsintProvider<Q, R>,
  deps: WrapperDeps,
): OsintProvider<Q, R> {
  return withTracing(
    withCache(withSingleFlight(withBreaker(withRateLimit(provider)), deps.redis), deps.redis),
  )
}
