export { applyWrappers, type WrapperDeps } from "@/core/wrappers/apply-wrappers.js"
export {
  type BreakerOptions,
  type BreakerPersist,
  type BreakerStateName,
  withBreaker,
} from "@/core/wrappers/with-breaker.js"
export { withCache } from "@/core/wrappers/with-cache.js"
export { type RateLimitOptions, withRateLimit } from "@/core/wrappers/with-rate-limit.js"
export { withTracing } from "@/core/wrappers/with-tracing.js"
// withSingleFlight stays a no-op stub until P9b-core stage 2 (its Redis
// pub/sub fan-out needs a running-stack integration test to land safely).
