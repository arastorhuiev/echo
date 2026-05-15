/**
 * Canonical BullMQ queue-name builder. Every per-provider queue is
 * `q.<providerId>` so we can wildcard-scan them in Redis Streams
 * (`bull:q.*:*`) and route per-provider concurrency limits later.
 */
export function queueName(providerId: string): string {
  return `q.${providerId}`
}

/**
 * Generic lookup queue — every lookup job (regardless of provider)
 * lands here; the processor dispatches by `job.data.providerId`.
 *
 * Per-provider queues (`q.<providerId>`) become useful when we want
 * independent BullMQ-level concurrency caps — that split lands later
 * (likely P9 hardening) once real providers expose distinct load
 * profiles.
 */
export const Q_LOOKUP = "q.lookup" as const
