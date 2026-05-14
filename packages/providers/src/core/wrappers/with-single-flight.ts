import type { Redis } from "ioredis"
import type { OsintProvider } from "@/core/provider.js"

/**
 * Single-flight: collapse concurrent identical queries to one upstream
 * call. The first arrival acquires a Redis lock keyed by query hash
 * and runs; followers subscribe to a `lookup:done:<hash>` pub/sub
 * channel and receive the result without hitting upstream.
 *
 * P5 is a pass-through — single-flight has real value once we have
 * multiple users hammering the same query. Implementation lands in
 * P9 (hardening) when the cache + breaker are also exercised under
 * realistic load.
 *
 * TODO(P9): Implement Redis SET NX PX lock + pub/sub fan-out.
 */
export function withSingleFlight<Q, R>(
  provider: OsintProvider<Q, R>,
  _redis: Redis,
): OsintProvider<Q, R> {
  return provider
}
