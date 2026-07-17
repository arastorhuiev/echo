/**
 * Canonical BullMQ queue-name builder. Every lookup runs on its own
 * per-provider queue `q.<providerId>`, so each provider gets an
 * independent BullMQ concurrency cap (P9b-core) and the queues can be
 * wildcard-scanned in Redis (`bull:q.*:*`) for the ops cockpit.
 */
export function queueName(providerId: string): string {
  return `q.${providerId}`
}
