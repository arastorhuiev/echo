/** Redis Stream key carrying realtime ProviderEvent fan-out for one lookup. */
export function lookupEventsKey(lookupId: string): string {
  return `lookup:events:${lookupId}`
}

/**
 * Redis pub/sub channel where the api publishes a cancel signal for a
 * running lookup. The worker's per-job subscriber listens here and
 * fires the AbortController on first message.
 */
export function lookupCancelChannel(lookupId: string): string {
  return `lookup:cancel:${lookupId}`
}
