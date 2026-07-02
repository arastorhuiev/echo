import type { AppConfigService } from "@echo/config"
import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import { DB_CLIENT, REDIS } from "@echo/nest"
import { applyWrappers, OsintProviderRegistry, ProviderError } from "@echo/providers"
import { type LookupJobData, lookupCancelChannel, lookupEventsKey, Q_LOOKUP } from "@echo/queue"
import { Processor, WorkerHost } from "@nestjs/bullmq"
import { Inject, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type { Job } from "bullmq"
import { Redis } from "ioredis"
import { trackProviderCost, wasCancelledWhileQueued } from "@/lookups/guards"

/** Stream TTL after the lookup terminates — keeps SSE replay window alive for late reconnects. */
const STREAM_TTL_SEC = 60 * 60

interface CancelSubscription {
  readonly cancelSub: Redis
  dispose(): Promise<void>
}

@Processor(Q_LOOKUP)
export class LookupProcessor extends WorkerHost {
  private readonly logger = new Logger(LookupProcessor.name)

  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly registry: OsintProviderRegistry,
    // AppConfigService is a type alias; see sidecar health indicator for why @Inject is required.
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {
    super()
  }

  /**
   * Generic lookup runner — resolves the provider from the registry,
   * wraps it with cross-cutting concerns, iterates the event stream,
   * and persists each event in lock-step to BOTH Postgres `lookup_events`
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

    // Cancel-while-queued: if the api cancelled this lookup while its job
    // sat in the queue, abort before touching the provider. The pub/sub
    // cancel channel only wakes an already-running job, so a persisted flag
    // is the only thing that stops a still-`waiting` job from running.
    if (await wasCancelledWhileQueued(this.redis, lookupId)) {
      await this.persistAndFanout(lookupId, 1, { _tag: "Cancelled" }, streamKey)
      await repositories.lookups.markCancelled(this.dbClient.db, lookupId)
      await this.redis.expire(streamKey, STREAM_TTL_SEC).catch(() => {})
      this.logger.log(
        `Lookup ${lookupId} cancelled before running (was queued, provider=${providerId})`,
      )
      return { cancelled: true }
    }

    // BullMQ retry: prior attempt's lookup_events would clash with the
    // new attempt's (lookup_id, seq) under the unique index. Idempotent
    // on the first attempt — no rows yet.
    if (job.attemptsMade > 0) {
      await repositories.lookupEvents.deleteByLookup(this.dbClient.db, lookupId)
    }

    const wrapped = applyWrappers(provider, {
      redis: this.redis,
      // Mirror every breaker transition + outcome into `providers` so the
      // ops cockpit (P13) reads live state and it survives a worker restart.
      persistBreaker: (id, state, outcome) =>
        repositories.providers.upsertHealth(this.dbClient.db, id, state, outcome),
    })
    const controller = new AbortController()
    const subscription = await this.setupCancelSubscriber(lookupId, controller)

    await repositories.lookups.markRunning(this.dbClient.db, lookupId)

    // Cost counter (count-only; enforcement is P9-pub). One INCR per run.
    const costWarn = this.config.get("COST_DAILY_WARN")
    const cost = await trackProviderCost({ redis: this.redis, warnThreshold: costWarn }, providerId)
    if (cost.crossedWarn) {
      this.logger.warn(
        `Provider ${providerId} crossed COST_DAILY_WARN=${costWarn} today (${cost.count} runs)`,
      )
    }

    let seq = 0
    let result: unknown

    try {
      for await (const event of wrapped.run(query, { lookupId, signal: controller.signal })) {
        seq++
        await this.persistAndFanout(lookupId, seq, event, streamKey)
        if (event._tag === "Final") result = event.data
      }
      await repositories.lookups.markDone(this.dbClient.db, lookupId, result)
      this.logger.log(`Lookup ${lookupId} completed (provider=${providerId}, events=${seq})`)
      return result
    } catch (err) {
      if (controller.signal.aborted) {
        seq++
        await this.handleCancellation(lookupId, seq, streamKey, providerId)
        return { cancelled: true }
      }
      seq++
      await this.handleFailure(lookupId, seq, streamKey, providerId, err)
      throw err
    } finally {
      // Bound the SSE replay window so old streams don't accumulate forever.
      await this.redis.expire(streamKey, STREAM_TTL_SEC).catch(() => {
        /* nothing useful to do if EXPIRE fails */
      })
      await subscription.dispose()
    }
  }

  /**
   * Dedicated ioredis connection for the lookup's cancel channel.
   * pub/sub locks the connection, so it can't share with cache/health
   * clients. The returned `dispose()` unsubscribes and disconnects.
   */
  private async setupCancelSubscriber(
    lookupId: string,
    controller: AbortController,
  ): Promise<CancelSubscription> {
    const cancelSub = new Redis(this.config.get("REDIS_URL"), {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    })
    await cancelSub.subscribe(lookupCancelChannel(lookupId))
    cancelSub.on("message", () => controller.abort())
    return {
      cancelSub,
      async dispose() {
        await cancelSub.unsubscribe().catch(() => {})
        cancelSub.disconnect()
      },
    }
  }

  /** Append one event to both durable history and the realtime fan-out stream. */
  private async persistAndFanout(
    lookupId: string,
    seq: number,
    event: unknown,
    streamKey: string,
  ): Promise<void> {
    await repositories.lookupEvents.append(this.dbClient.db, lookupId, seq, event)
    await this.redis.xadd(streamKey, "*", "data", JSON.stringify(event))
  }

  private async handleCancellation(
    lookupId: string,
    seq: number,
    streamKey: string,
    providerId: string,
  ): Promise<void> {
    const event = { _tag: "Cancelled" as const }
    await this.persistAndFanout(lookupId, seq, event, streamKey)
    await repositories.lookups.markCancelled(this.dbClient.db, lookupId)
    this.logger.log(`Lookup ${lookupId} cancelled (provider=${providerId})`)
  }

  private async handleFailure(
    lookupId: string,
    seq: number,
    streamKey: string,
    providerId: string,
    err: unknown,
  ): Promise<void> {
    const kind = err instanceof ProviderError ? err.kind : "Unknown"
    const message = err instanceof Error ? err.message : String(err)
    const event = { _tag: "Failed" as const, kind, message }
    await this.persistAndFanout(lookupId, seq, event, streamKey)
    await repositories.lookups.markFailed(this.dbClient.db, lookupId, kind, message)
    this.logger.warn(`Lookup ${lookupId} failed (provider=${providerId}, kind=${kind}): ${message}`)
  }
}
