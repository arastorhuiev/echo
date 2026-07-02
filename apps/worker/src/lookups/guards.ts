import { lookupCancelledKey, providerCostKey } from "@echo/queue"
import type { Redis } from "ioredis"

/** Keep the daily cost bucket around ~2 days so old days self-expire. */
const COST_KEY_TTL_SEC = 2 * 24 * 3_600

/** UTC `YYYYMMDD` bucket for the per-provider daily cost counter. */
export function costDay(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, "")
}

/**
 * Was this lookup cancelled while its job was still queued? The api sets a
 * persisted flag on cancel; the worker checks it at the top of the handler
 * so a job cancelled while `waiting` never reaches its provider (the pub/sub
 * cancel channel only wakes an already-running job).
 */
export async function wasCancelledWhileQueued(redis: Redis, lookupId: string): Promise<boolean> {
  return (await redis.get(lookupCancelledKey(lookupId))) !== null
}

export interface CostTrackerDeps {
  readonly redis: Redis
  /** `COST_DAILY_WARN` — 0 disables the soft warning. */
  readonly warnThreshold: number
  /** Injectable clock (tests). Defaults to `Date`. */
  readonly now?: () => Date
}

export interface CostResult {
  readonly count: number
  /** True exactly on the run that crosses `warnThreshold`, so the caller logs once. */
  readonly crossedWarn: boolean
}

/**
 * Increment the provider's daily run counter (count-only — no enforcement).
 * Returns the new count and whether this run crossed the warn threshold.
 */
export async function trackProviderCost(
  { redis, warnThreshold, now }: CostTrackerDeps,
  providerId: string,
): Promise<CostResult> {
  const day = costDay((now ?? (() => new Date()))())
  const key = providerCostKey(providerId, day)
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, COST_KEY_TTL_SEC)
  return { count, crossedWarn: warnThreshold > 0 && count === warnThreshold + 1 }
}
