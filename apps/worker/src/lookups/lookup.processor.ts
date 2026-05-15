import type { AppConfigService } from "@echo/config"
import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import { DB_CLIENT, REDIS } from "@echo/nest"
import { applyWrappers, OsintProviderRegistry, ProviderError } from "@echo/providers"
import { type LookupJobData, lookupCancelChannel, lookupEventsKey, Q_LOOKUP } from "@echo/queue"
import { Processor, WorkerHost } from "@nestjs/bullmq"
import { Inject, Logger } from "@nestjs/common"
import type { Job } from "bullmq"
import { Redis } from "ioredis"

/** Stream TTL after the lookup terminates — keeps SSE replay window alive for late reconnects. */
const STREAM_TTL_SEC = 60 * 60

@Processor(Q_LOOKUP)
export class LookupProcessor extends WorkerHost {
  private readonly logger = new Logger(LookupProcessor.name)

  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly registry: OsintProviderRegistry,
    private readonly config: AppConfigService,
  ) {
    super()
  }

  /**
   * Generic lookup runner — resolves the provider from the registry,
   * wraps it with all cross-cutting concerns (cache / single-flight /
   * breaker / rate-limit / tracing), iterates the event stream, and
   * persists each event in lock-step to BOTH Postgres `lookup_events`
   * (durable history) AND a Redis Stream `lookup:events:<id>`
   * (realtime fan-out for SSE consumers).
   *
   * Cancellation: a per-job ioredis subscriber listens on
   * `lookup:cancel:<id>` (pub/sub). The first message there fires the
   * AbortController; the wrapped provider's run() unwinds; we persist a
   * `Cancelled` event and mark the row.
   */
  async process(job: Job<LookupJobData>): Promise<unknown> {
    const { lookupId, providerId, query } = job.data
    const streamKey = lookupEventsKey(lookupId)

    const provider = this.registry.get(providerId)
    if (!provider) {
      throw new Error(`Unknown providerId in job ${job.id}: ${providerId}`)
    }

    // BullMQ retry: the prior attempt's lookup_events rows would clash
    // with the new attempt's (lookup_id, seq) values under the unique
    // index, so wipe them. Idempotent on first attempt (no rows yet).
    if (job.attemptsMade > 0) {
      await repositories.lookupEvents.deleteByLookup(this.dbClient.db, lookupId)
    }

    const wrapped = applyWrappers(provider, { redis: this.redis })
    const controller = new AbortController()

    // Dedicated ioredis connection — pub/sub locks the connection,
    // so it can't share with the cache/health-check Redis client.
    const cancelSub = new Redis(this.config.get("REDIS_URL"), {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    })
    await cancelSub.subscribe(lookupCancelChannel(lookupId))
    cancelSub.on("message", () => controller.abort())

    await repositories.lookups.markRunning(this.dbClient.db, lookupId)

    let seq = 0
    let result: unknown

    try {
      for await (const event of wrapped.run(query, { lookupId, signal: controller.signal })) {
        seq++
        await repositories.lookupEvents.append(this.dbClient.db, lookupId, seq, event)
        await this.redis.xadd(streamKey, "*", "data", JSON.stringify(event))
        if (event._tag === "Final") result = event.data
      }
      await repositories.lookups.markDone(this.dbClient.db, lookupId, result)
      this.logger.log(`Lookup ${lookupId} completed (provider=${providerId}, events=${seq})`)
      return result
    } catch (err) {
      if (controller.signal.aborted) {
        seq++
        const cancelEvent = { _tag: "Cancelled" as const }
        await repositories.lookupEvents.append(this.dbClient.db, lookupId, seq, cancelEvent)
        await this.redis.xadd(streamKey, "*", "data", JSON.stringify(cancelEvent))
        await repositories.lookups.markCancelled(this.dbClient.db, lookupId)
        this.logger.log(`Lookup ${lookupId} cancelled (provider=${providerId})`)
        return { cancelled: true }
      }

      const kind = err instanceof ProviderError ? err.kind : "Unknown"
      const message = err instanceof Error ? err.message : String(err)
      seq++
      const failedEvent = { _tag: "Failed" as const, kind, message }
      await repositories.lookupEvents.append(this.dbClient.db, lookupId, seq, failedEvent)
      await this.redis.xadd(streamKey, "*", "data", JSON.stringify(failedEvent))
      await repositories.lookups.markFailed(this.dbClient.db, lookupId, kind, message)

      this.logger.warn(
        `Lookup ${lookupId} failed (provider=${providerId}, kind=${kind}): ${message}`,
      )
      throw err
    } finally {
      // Bound the SSE replay window so old streams don't accumulate forever.
      await this.redis.expire(streamKey, STREAM_TTL_SEC).catch(() => {
        /* nothing useful to do if EXPIRE fails */
      })
      // Tear down the per-job cancel subscriber.
      await cancelSub.unsubscribe().catch(() => {})
      cancelSub.disconnect()
    }
  }
}
