import type { Redis } from "ioredis"
import { breakerKeys } from "@/core/breaker-keys.js"
import { type OsintProvider, ProviderError } from "@/core/provider.js"

/**
 * Circuit-breaker state, mirrored to the `providers` table (via the
 * `persist` callback) so the ops cockpit can read it. Kept structurally
 * identical to `@echo/db`'s `BreakerState` without importing it — the
 * providers package stays free of a DB dependency.
 */
export type BreakerStateName = "closed" | "half_open" | "open"

/**
 * Sink for breaker transitions + per-run outcomes. The worker wires this
 * to `repositories.providers.upsertHealth(db, ...)` so Postgres always
 * reflects the live breaker state; omit it and the breaker still works
 * entirely in Redis.
 */
export type BreakerPersist = (
  id: string,
  state: BreakerStateName,
  outcome: "success" | "failure",
) => Promise<void>

export interface BreakerOptions {
  readonly redis: Redis
  readonly persist?: BreakerPersist
  /** Injectable clock (tests). Defaults to `Date.now`. */
  readonly now?: () => number
}

/**
 * Circuit breaker: short-circuit a provider that has been failing so we
 * stop hammering a hosed upstream. The failure-count state machine lives
 * in Redis (shared across worker replicas, survives a worker restart);
 * every transition and per-run outcome is also mirrored to Postgres via
 * `persist` for the ops cockpit.
 *
 * States (`providers.breaker_state`):
 * - **closed** — normal. Each failure increments a Redis counter; when it
 *   reaches `defaults.breaker.failureThreshold` the breaker opens.
 * - **open** — short-circuits every run with a `CircuitOpen` ProviderError
 *   (no upstream call) until `defaults.breaker.resetMs` has elapsed since
 *   it opened, then it lets ONE probe through (half-open).
 * - **half_open** — a single probe runs: success closes the breaker and
 *   clears the counter; failure re-opens it immediately.
 *
 * Cancellation (aborted signal) is never counted as a failure. The
 * read-modify-write on the counter is not atomic across replicas — a
 * breaker tolerates a small over/under-count under high concurrency.
 */
export function withBreaker<Q, R>(
  provider: OsintProvider<Q, R>,
  opts: BreakerOptions,
): OsintProvider<Q, R> {
  const { redis } = opts
  const now = opts.now ?? Date.now
  const { failureThreshold, resetMs } = provider.defaults.breaker
  const id = provider.id
  const { state: stateKey, failures: failKey, openedAt: openedKey } = breakerKeys(id)

  async function persist(state: BreakerStateName, outcome: "success" | "failure"): Promise<void> {
    if (!opts.persist) return
    try {
      await opts.persist(id, state, outcome)
    } catch {
      // Persistence is observability, never load-bearing for the run.
    }
  }

  async function onSuccess(): Promise<void> {
    await redis.set(stateKey, "closed")
    await redis.del(failKey)
    await redis.del(openedKey)
    await persist("closed", "success")
  }

  async function onFailure(probing: boolean): Promise<void> {
    const failures = await redis.incr(failKey)
    if (probing || failures >= failureThreshold) {
      await redis.set(stateKey, "open")
      await redis.set(openedKey, String(now()))
      await persist("open", "failure")
    } else {
      await persist("closed", "failure")
    }
  }

  return {
    ...provider,
    async *run(query, ctx) {
      const state = (await redis.get(stateKey)) as BreakerStateName | null
      let probing = false

      if (state === "open") {
        const openedAt = Number(await redis.get(openedKey)) || 0
        if (now() - openedAt >= resetMs) {
          await redis.set(stateKey, "half_open")
          probing = true
        } else {
          throw new ProviderError(id, "CircuitOpen", `circuit breaker open for ${id}`)
        }
      } else if (state === "half_open") {
        probing = true
      }

      try {
        yield* provider.run(query, ctx)
      } catch (err) {
        // A user-cancelled run is not an upstream failure — don't trip.
        if (ctx.signal.aborted) throw err
        await onFailure(probing)
        throw err
      }
      await onSuccess()
    },
  }
}
