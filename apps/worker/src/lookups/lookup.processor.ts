import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import { applyWrappers, OsintProviderRegistry, ProviderError } from "@echo/providers"
import { type LookupJobData, Q_LOOKUP } from "@echo/queue"
import { Processor, WorkerHost } from "@nestjs/bullmq"
import { Inject, Logger } from "@nestjs/common"
import type { Job } from "bullmq"
import type { Redis } from "ioredis"
import { DB_CLIENT } from "@/db/tokens"
import { REDIS } from "@/redis/tokens"

@Processor(Q_LOOKUP)
export class LookupProcessor extends WorkerHost {
  private readonly logger = new Logger(LookupProcessor.name)

  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly registry: OsintProviderRegistry,
  ) {
    super()
  }

  /**
   * Generic lookup runner — resolves the provider from the registry,
   * wraps it with all cross-cutting concerns (cache / single-flight /
   * breaker / rate-limit / tracing), iterates the event stream, and
   * persists each event to `lookup_events` while transitioning the
   * `lookups` row state.
   *
   * Throws on provider failure so BullMQ retries per the queue policy
   * (3 attempts with exponential backoff — see @echo/queue).
   */
  async process(job: Job<LookupJobData>): Promise<unknown> {
    const { lookupId, providerId, query } = job.data

    const provider = this.registry.get(providerId)
    if (!provider) {
      throw new Error(`Unknown providerId in job ${job.id}: ${providerId}`)
    }

    const wrapped = applyWrappers(provider, { redis: this.redis })
    const controller = new AbortController()

    await repositories.lookups.markRunning(this.dbClient.db, lookupId)

    let seq = 0
    let result: unknown

    try {
      for await (const event of wrapped.run(query, { lookupId, signal: controller.signal })) {
        seq++
        await repositories.lookupEvents.append(this.dbClient.db, lookupId, seq, event)
        if (event._tag === "Final") {
          result = event.data
        }
      }
      await repositories.lookups.markDone(this.dbClient.db, lookupId, result)
      this.logger.log(`Lookup ${lookupId} completed (provider=${providerId}, events=${seq})`)
      return result
    } catch (err) {
      const kind = err instanceof ProviderError ? err.kind : "Unknown"
      const message = err instanceof Error ? err.message : String(err)

      seq++
      await repositories.lookupEvents.append(this.dbClient.db, lookupId, seq, {
        _tag: "Failed",
        kind,
        message,
      })
      await repositories.lookups.markFailed(this.dbClient.db, lookupId, kind, message)

      this.logger.warn(
        `Lookup ${lookupId} failed (provider=${providerId}, kind=${kind}): ${message}`,
      )
      throw err
    }
  }
}
