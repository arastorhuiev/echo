import type { Redis } from "ioredis"
import { providerResultCacheKey } from "@/core/cache-keys.js"
import { queryHash } from "@/core/canonicalize.js"
import type { OsintProvider } from "@/core/provider.js"

/**
 * Result cache. Skips upstream entirely on hit — yields a synthetic
 * `Started` then `Final` from the cached value. Misses fall through to
 * the underlying provider; a successful Final value is written back
 * with the provider's configured TTL.
 *
 * Cache is bypassed when `defaults.cacheTtlSec === 0`.
 */
export function withCache<Q, R>(provider: OsintProvider<Q, R>, redis: Redis): OsintProvider<Q, R> {
  if (provider.defaults.cacheTtlSec <= 0) {
    return provider
  }
  return {
    ...provider,
    async *run(query, ctx) {
      const key = providerResultCacheKey(provider.id, queryHash(query))
      const cached = await redis.get(key)
      if (cached !== null) {
        try {
          const data = JSON.parse(cached) as R
          yield { _tag: "Started" }
          yield { _tag: "Final", data }
          return
        } catch {
          // Corrupted cached value — fall through to a fresh run and let
          // the upstream value overwrite it.
        }
      }

      let final: R | undefined
      for await (const event of provider.run(query, ctx)) {
        yield event
        if (event._tag === "Final") {
          final = event.data
        }
      }
      if (final !== undefined) {
        await redis.set(key, JSON.stringify(final), "EX", provider.defaults.cacheTtlSec)
      }
    },
  }
}
