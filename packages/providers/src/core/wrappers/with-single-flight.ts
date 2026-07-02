import type { Redis } from "ioredis"
import { queryHash } from "@/core/canonicalize.js"
import type { OsintProvider } from "@/core/provider.js"

const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const DEFAULT_RESULT_TTL_MS = 30_000

export interface SingleFlightOptions {
  /** How long a follower waits for the leader's result before running itself. */
  readonly waitTimeoutMs?: number
  /** How long the shared result stays readable for late followers. */
  readonly resultTtlMs?: number
  /** Lock TTL; defaults to the provider timeout + 5 s so a crashed leader self-heals. */
  readonly lockTtlMs?: number
}

function safeParse<R>(raw: string): R | null {
  try {
    return JSON.parse(raw) as R
  } catch {
    return null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function whenAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true })
  })
}

/**
 * Single-flight: collapse concurrent identical queries to ONE upstream
 * call. The first arrival acquires a Redis `SET NX PX` lock and runs for
 * real; concurrent duplicates (same provider + query hash) subscribe to a
 * pub/sub channel, receive the leader's cached final result, and emit a
 * synthetic `Started` + `Final` without touching upstream.
 *
 * Only the FINAL result is shared — followers don't replay the leader's
 * `Partial`/`Progress` stream. Sits between cache (a hit skips this) and
 * breaker (the leader's one call is what the breaker accounts for).
 *
 * Never hangs: a follower falls through to run itself on leader failure,
 * a lock-TTL expiry, a wait timeout, or cancellation.
 */
export function withSingleFlight<Q, R>(
  provider: OsintProvider<Q, R>,
  redis: Redis,
  opts: SingleFlightOptions = {},
): OsintProvider<Q, R> {
  const waitTimeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const resultTtlMs = opts.resultTtlMs ?? DEFAULT_RESULT_TTL_MS
  const lockTtlMs = opts.lockTtlMs ?? Math.max(provider.defaults.timeoutMs + 5_000, 10_000)

  async function waitForResult(
    resultKey: string,
    channel: string,
    signal: AbortSignal,
  ): Promise<R | null> {
    const sub = redis.duplicate()
    try {
      await sub.subscribe(channel)
      const messaged = new Promise<void>((resolve) => {
        sub.on("message", () => resolve())
      })
      // The leader stores the result BEFORE publishing, so an early read
      // (after we're already subscribed) catches a leader that finished
      // in the subscribe window.
      const early = await redis.get(resultKey)
      if (early !== null) return safeParse<R>(early)

      await Promise.race([messaged, delay(waitTimeoutMs), whenAborted(signal)])
      const late = await redis.get(resultKey)
      return late !== null ? safeParse<R>(late) : null
    } finally {
      await sub.unsubscribe().catch(() => {})
      sub.disconnect()
    }
  }

  return {
    ...provider,
    async *run(query, ctx) {
      const hash = queryHash(query)
      const lockKey = `singleflight:lock:${provider.id}:${hash}`
      const resultKey = `singleflight:result:${provider.id}:${hash}`
      const channel = `singleflight:done:${provider.id}:${hash}`

      const acquired = await redis.set(lockKey, "1", "PX", lockTtlMs, "NX")

      if (acquired !== "OK") {
        // Follower: try to ride the leader's result; fall through on miss.
        const shared = await waitForResult(resultKey, channel, ctx.signal)
        if (shared !== null) {
          yield { _tag: "Started" }
          yield { _tag: "Final", data: shared }
          return
        }
        yield* provider.run(query, ctx)
        return
      }

      // Leader: run for real, then fan the final result out to followers.
      let final: R | undefined
      try {
        for await (const event of provider.run(query, ctx)) {
          yield event
          if (event._tag === "Final") final = event.data
        }
      } catch (err) {
        await redis.publish(channel, "fail").catch(() => {})
        await redis.del(lockKey).catch(() => {})
        throw err
      }

      if (final !== undefined) {
        await redis.set(resultKey, JSON.stringify(final), "PX", resultTtlMs).catch(() => {})
        await redis.publish(channel, "ok").catch(() => {})
      } else {
        await redis.publish(channel, "fail").catch(() => {})
      }
      await redis.del(lockKey).catch(() => {})
    },
  }
}
