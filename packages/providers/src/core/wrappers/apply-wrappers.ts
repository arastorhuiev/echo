import type { Redis } from "ioredis"
import type { OsintProvider } from "@/core/provider.js"
import { withCache } from "@/core/wrappers/with-cache.js"
import { withTracing } from "@/core/wrappers/with-tracing.js"

export interface WrapperDeps {
  /** Shared ioredis client used by cache + single-flight. */
  readonly redis: Redis
}

/**
 * Compose every cross-cutting wrapper around a provider. Order matters:
 * tracing wraps the outside so cache hits, future breaker short-circuits,
 * etc. all show up in the same span.
 *
 * Currently active: cache + tracing. The single-flight, breaker, and
 * rate-limit wrappers will be added back in P9 (hardening) once their
 * real implementations land — the stub pass-through versions live in
 * `with-{single-flight,breaker,rate-limit}.ts` with their planned
 * design captured in module-level comments.
 *
 * The composer is THE place to add or reorder wrappers — providers
 * never call them directly.
 */
export function applyWrappers<Q, R>(
  provider: OsintProvider<Q, R>,
  deps: WrapperDeps,
): OsintProvider<Q, R> {
  return withTracing(withCache(provider, deps.redis))
}
