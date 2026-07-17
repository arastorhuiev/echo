/**
 * Pure, env-gated decision helpers for the public hardening guard (P9-pub).
 * Each returns false when its knob is 0 (the default) so the check is a
 * no-op until production turns it on.
 */

/** Per-IP fixed-window rate limit: the INCR'd count exceeds the per-minute limit. */
export function isRateLimited(count: number, limitPerMinute: number): boolean {
  return limitPerMinute > 0 && count > limitPerMinute
}

/** Backpressure: total waiting jobs across all queues exceeds the ceiling. */
export function isBackpressured(totalWaiting: number, max: number): boolean {
  return max > 0 && totalWaiting > max
}

/** Cost cap: today's total run-count exceeds the hard daily cap. */
export function isOverCostCap(totalToday: number, cap: number): boolean {
  return cap > 0 && totalToday > cap
}

/** UTC minute bucket for the rate-limit key (stable within a 60 s window). */
export function minuteBucket(nowMs: number): number {
  return Math.floor(nowMs / 60_000)
}
