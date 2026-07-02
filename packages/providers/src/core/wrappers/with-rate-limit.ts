import type { Redis } from "ioredis"
import type { OsintProvider } from "@/core/provider.js"

const DEFAULT_RATE_PER_SEC = 10
/** Safety cap on window-waits so a misconfiguration can never hang a run forever. */
const MAX_WAITS = 20

export interface RateLimitOptions {
  /** Injectable clock (tests). Defaults to `Date.now`. */
  readonly now?: () => number
  /** Injectable sleep (tests). Rejects if the signal aborts. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true },
    )
  })
}

/**
 * Outbound rate limiter — a per-provider fixed 1 s window counter in
 * Redis, capped at `provider.defaults.ratePerSec` (default 10/s). When a
 * window is full the run waits for the next window before starting; the
 * cap is shared across worker replicas via Redis.
 *
 * Sits INSIDE the breaker (so a short-circuited run never burns a token)
 * and inside the cache (so cache hits are free). A misconfiguration can
 * never hang a run: after `MAX_WAITS` deferrals it proceeds anyway.
 */
export function withRateLimit<Q, R>(
  provider: OsintProvider<Q, R>,
  redis: Redis,
  opts: RateLimitOptions = {},
): OsintProvider<Q, R> {
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? defaultSleep
  const limit = provider.defaults.ratePerSec ?? DEFAULT_RATE_PER_SEC

  return {
    ...provider,
    async *run(query, ctx) {
      for (let waits = 0; waits < MAX_WAITS; waits++) {
        const t = now()
        const windowKey = `ratelimit:${provider.id}:${Math.floor(t / 1000)}`
        const count = await redis.incr(windowKey)
        if (count === 1) {
          // First hit in this window — bound the key's lifetime.
          await redis.pexpire(windowKey, 2_000)
        }
        if (count <= limit) break
        await sleep(1_000 - (t % 1_000), ctx.signal)
      }
      yield* provider.run(query, ctx)
    },
  }
}
