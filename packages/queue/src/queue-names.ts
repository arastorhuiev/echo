/**
 * Canonical BullMQ queue-name builder. Every lookup runs on its own
 * per-provider queue `q.<providerId>`, so each provider gets an
 * independent BullMQ concurrency cap (P9b-core) and the queues can be
 * wildcard-scanned in Redis (`bull:q.*:*`) for the ops cockpit.
 */
export function queueName(providerId: string): string {
  return `q.${providerId}`
}

/**
 * Dedicated queue for search-orchestration jobs (P12). One job per
 * `POST /api/search`; the worker aggregator fans the child lookups out onto
 * the per-provider queues and merges their event streams. Kept separate
 * from `q.<providerId>` so orchestration never competes with real provider
 * runs for a provider queue's slots.
 */
export const Q_SEARCH = "q.search" as const
