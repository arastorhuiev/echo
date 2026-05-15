export { applyWrappers, type WrapperDeps } from "@/core/wrappers/apply-wrappers.js"
export { withCache } from "@/core/wrappers/with-cache.js"
export { withTracing } from "@/core/wrappers/with-tracing.js"
// P9 wrappers (currently no-op stubs) are not re-exported. Reinstate
// alongside the real implementations when hardening lands:
//   export { withBreaker } from "@/core/wrappers/with-breaker.js"
//   export { withRateLimit } from "@/core/wrappers/with-rate-limit.js"
//   export { withSingleFlight } from "@/core/wrappers/with-single-flight.js"
