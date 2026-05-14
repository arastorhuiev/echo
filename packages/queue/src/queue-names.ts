/**
 * Canonical BullMQ queue-name builder. Every per-provider queue is
 * `q.<providerId>` so we can wildcard-scan them in Redis Streams (`bull:q.*:*`)
 * and route per-provider concurrency limits in P5.
 */
export function queueName(providerId: string): string {
  return `q.${providerId}`
}

/**
 * Demo queue used by the P4 internal smoke-test endpoint and worker
 * processor. Removed (or repurposed) once real provider queues land in P5+.
 */
export const Q_ECHO = "q.echo" as const
