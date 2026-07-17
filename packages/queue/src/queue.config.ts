import type { ConnectionOptions, JobsOptions } from "bullmq"
import { queueName } from "@/queue-names.js"

export interface DefaultQueueOptionsInput {
  /** Provider identifier — becomes the queue name as `q.<providerId>`. */
  providerId: string
}

export interface DefaultQueueOptions {
  readonly name: string
  readonly defaultJobOptions: JobsOptions
}

/**
 * Per-queue defaults applied at registration time:
 * - 3 attempts with exponential backoff (1 s base) — covers transient
 *   network blips and short upstream rate-limits without ballooning
 * - completed jobs trimmed at 1 h or 1 000 most-recent (whichever first)
 * - failed jobs retained 24 h or 5 000 most-recent for postmortem
 *
 * Per-provider concurrency / circuit-breaker / rate-limit policies live
 * on the Worker side (P9b-core), not in the producer's defaults.
 */
export function defaultQueueOptions(input: DefaultQueueOptionsInput): DefaultQueueOptions {
  return {
    name: queueName(input.providerId),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 24 * 3_600, count: 5_000 },
    },
  }
}

/**
 * The single source of truth for the BullMQ Redis connection, shared by
 * every imperative `Queue` (producer, apps/api) and `Worker` (consumer,
 * apps/worker) across the per-provider queue fan-out.
 *
 * `maxRetriesPerRequest: null` is mandatory — BullMQ workers issue
 * blocking commands (BRPOPLPUSH); with a finite retry budget ioredis
 * aborts them and BullMQ throws "command not allowed when used by Bull".
 */
export function bullConnection(redisUrl: string): ConnectionOptions {
  return { url: redisUrl, maxRetriesPerRequest: null }
}
