/** Redis Stream key carrying realtime ProviderEvent fan-out for one lookup. */
export function lookupEventsKey(lookupId: string): string {
  return `lookup:events:${lookupId}`
}

/** Redis Stream key carrying the aggregated event fan-out for one search (P12). */
export function searchEventsKey(searchId: string): string {
  return `search:events:${searchId}`
}

/**
 * Persisted cancel flag for an orchestrated search (P12). Set by the api on
 * `DELETE /api/search/:id`; the worker aggregator checks it to stop watching
 * children and emit a terminal Cancelled. Cascades to each child via the
 * per-lookup cancel flag/channel.
 */
export function searchCancelledKey(searchId: string): string {
  return `search:cancelled:${searchId}`
}

/**
 * Redis pub/sub channel where the api publishes a cancel signal for a
 * running lookup. The worker's per-job subscriber listens here and
 * fires the AbortController on first message.
 */
export function lookupCancelChannel(lookupId: string): string {
  return `lookup:cancel:${lookupId}`
}

/**
 * Persisted cancel flag. Set by the api when a lookup is cancelled; read
 * at the top of the worker's job handler so a job cancelled while still
 * `waiting` in the queue aborts before its provider ever runs (the pub/sub
 * channel above only reaches an already-running job).
 */
export function lookupCancelledKey(lookupId: string): string {
  return `lookup:cancelled:${lookupId}`
}

/**
 * Per-provider daily run counter (`cost:<provider>:<YYYYMMDD>`). INCR'd once
 * per run; a soft `COST_DAILY_WARN` threshold logs a warning. Enforcement
 * (hard cap) is deferred to P9-pub.
 */
export function providerCostKey(providerId: string, yyyymmdd: string): string {
  return `cost:${providerId}:${yyyymmdd}`
}

/**
 * UTC `YYYYMMDD` bucket for the per-provider daily cost counter. Shared so
 * the worker (which INCRs the counter) and the api ops cockpit (which reads
 * it) agree on the exact day key.
 */
export function costDay(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, "")
}
