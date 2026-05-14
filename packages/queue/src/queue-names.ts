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

/**
 * Generic lookup queue used by P5 — every lookup job (regardless of
 * provider) lands here. The processor dispatches by `job.data.providerId`.
 *
 * Per-provider queues (`q.<providerId>`) become useful when we want
 * independent BullMQ-level concurrency caps — that split lands later
 * (likely P5.1 or P9 hardening) once real providers expose distinct
 * load profiles.
 */
export const Q_LOOKUP = "q.lookup" as const
