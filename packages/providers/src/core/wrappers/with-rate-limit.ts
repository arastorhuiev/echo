import type { OsintProvider } from "@/core/provider.js"

/**
 * Outbound rate limiter — token bucket per provider, applied to the
 * underlying HttpClient inside the provider's run().
 *
 * P5 is a pass-through. Concrete enforcement requires the provider to
 * surface its outbound HttpClient through a hook (so the wrapper can
 * inject the bucket); that integration lands when we have a real
 * provider and `@echo/http-clients` (P5.1+ / P9).
 *
 * TODO(P9): Implement token-bucket via Redis incr+expire or in-process
 * `bottleneck` library, configured from `provider.defaults`.
 */
export function withRateLimit<Q, R>(provider: OsintProvider<Q, R>): OsintProvider<Q, R> {
  return provider
}
