import type { AppConfigService } from "@echo/config"
import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import { DB_CLIENT, REDIS } from "@echo/nest"
import {
  lookupEventsKey,
  type SearchJobData,
  searchCancelledKey,
  searchEventsKey,
} from "@echo/queue"
import { Inject, Injectable, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type { Job } from "bullmq"
import { Redis } from "ioredis"
import { type ChildResult, mergeSearchReport } from "@/search/merge"

const STREAM_TTL_SEC = 60 * 60
const XREAD_BLOCK_MS = 1_000
/**
 * Hard ceiling on how long the aggregator waits for children. Longer than the
 * slowest provider timeout (~120 s) plus queue wait, so a healthy fan-out
 * always finishes first — but bounded so a child whose worker died (no
 * terminal event ever written) can't hang the whole search forever.
 */
const AGG_MAX_MS = 10 * 60 * 1_000
const LOOKUP_EVENTS_PREFIX = lookupEventsKey("")

/**
 * Worker-side aggregator for one orchestrated search (P12). The api has
 * already enqueued every child lookup on its per-provider queue; this job
 * watches all the children's `lookup:events:<id>` Redis streams over a
 * single blocking connection, forwards each `Partial` to the search stream
 * (tagged with its providerId), collects each child's terminal outcome, and
 * writes the merged/deduped report when every child is terminal.
 *
 * A failed/cancelled child is recorded, never fatal. The search cancel flag
 * (`search:cancelled:<id>`) short-circuits the whole run to Cancelled.
 */
@Injectable()
export class SearchAggregator {
  private readonly logger = new Logger(SearchAggregator.name)

  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  async run(job: Job<SearchJobData>): Promise<unknown> {
    const { searchId, children } = job.data
    const searchKey = searchEventsKey(searchId)

    // Any throw below MUST still emit a terminal event — otherwise a
    // GET /:id/stream consumer blocks on heartbeats forever (the q.search
    // queue has no retries) and the searches row stays non-terminal.
    try {
      const search = await repositories.searches.findById(this.dbClient.db, searchId)
      if (!search) {
        await this.finishFailed(searchId, searchKey, `unknown searchId ${searchId}`)
        return { failed: true }
      }

      if (await this.isCancelled(searchId)) {
        return this.finishCancelled(searchId, searchKey)
      }

      await repositories.searches.markRunning(this.dbClient.db, searchId)
      await this.emit(searchKey, { _tag: "Started" })

      const results = await this.aggregate(searchId, children, searchKey)

      if (await this.isCancelled(searchId)) {
        return this.finishCancelled(searchId, searchKey)
      }

      const report = mergeSearchReport(search.identifier, search.kind, results)
      await repositories.searches.markDone(this.dbClient.db, searchId, report)
      await this.emit(searchKey, { _tag: "Final", data: report })
      await this.redis.expire(searchKey, STREAM_TTL_SEC).catch(() => {})
      this.logger.log(
        `Search ${searchId} done (kind=${search.kind}, children=${children.length}, accounts=${report.accounts.length})`,
      )
      return report
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.finishFailed(searchId, searchKey, message)
      return { failed: true }
    }
  }

  /**
   * Fan-in every child stream on one BLOCK-reading connection. Cursors start
   * at "0" so events are picked up even though the children may have started
   * before this aggregator did (Redis streams retain history). Returns one
   * ChildResult per child, in the input order.
   */
  private async aggregate(
    searchId: string,
    children: SearchJobData["children"],
    searchKey: string,
  ): Promise<ChildResult[]> {
    const conn = new Redis(this.config.get("REDIS_URL"), {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    })
    const providerByLookup = new Map(children.map((c) => [c.lookupId, c.providerId]))
    const cursors = new Map(children.map((c) => [c.lookupId, "0"]))
    const results = new Map<string, ChildResult>()
    const deadline = Date.now() + AGG_MAX_MS
    let timedOut = false

    try {
      while (results.size < children.length) {
        if (await this.isCancelled(searchId)) break
        if (Date.now() > deadline) {
          timedOut = true
          this.logger.warn(
            `Search ${searchId} aggregation timed out with ${children.length - results.size} child(ren) unfinished`,
          )
          break
        }

        const pending = children.filter((c) => !results.has(c.lookupId))
        const keys = pending.map((c) => lookupEventsKey(c.lookupId))
        const ids = pending.map((c) => cursors.get(c.lookupId) ?? "0")
        const res = await conn.xread("BLOCK", XREAD_BLOCK_MS, "STREAMS", ...keys, ...ids)
        if (!res) continue

        for (const [streamKey, entries] of res) {
          const lookupId = streamKey.slice(LOOKUP_EVENTS_PREFIX.length)
          const providerId = providerByLookup.get(lookupId) ?? "unknown"
          for (const [streamId, fields] of entries) {
            cursors.set(lookupId, streamId)
            const terminal = await this.handleChildEvent(searchKey, providerId, fields[1] ?? "")
            if (terminal) results.set(lookupId, terminal)
          }
        }
      }
    } finally {
      conn.disconnect()
    }

    // Any child still unfinished is recorded: a timeout marks it failed (its
    // worker likely died); a cancel-break leaves it cancelled (run() then
    // finalizes the whole search as Cancelled without using these).
    return children.map((c) => {
      const done = results.get(c.lookupId)
      if (done) return done
      return timedOut
        ? { providerId: c.providerId, status: "failed", error: "aggregation timeout" }
        : { providerId: c.providerId, status: "cancelled" }
    })
  }

  /**
   * Forward a child event to the search stream and, if terminal, return the
   * child's ChildResult (else null to keep watching).
   */
  private async handleChildEvent(
    searchKey: string,
    providerId: string,
    raw: string,
  ): Promise<ChildResult | null> {
    let event: { _tag?: string; chunk?: unknown; data?: unknown; message?: string }
    try {
      event = JSON.parse(raw)
    } catch {
      return null
    }
    switch (event._tag) {
      case "Partial":
        await this.emit(searchKey, { _tag: "Partial", chunk: { providerId, data: event.chunk } })
        return null
      case "Final":
        return { providerId, status: "done", data: event.data }
      case "Failed":
        return { providerId, status: "failed", error: event.message ?? "provider failed" }
      case "Cancelled":
        return { providerId, status: "cancelled" }
      default:
        // Started / Progress — not forwarded (the search emits its own Started).
        return null
    }
  }

  private async finishCancelled(searchId: string, searchKey: string): Promise<unknown> {
    await repositories.searches.markCancelled(this.dbClient.db, searchId)
    await this.emit(searchKey, { _tag: "Cancelled" })
    await this.redis.expire(searchKey, STREAM_TTL_SEC).catch(() => {})
    this.logger.log(`Search ${searchId} cancelled`)
    return { cancelled: true }
  }

  private async finishFailed(searchId: string, searchKey: string, message: string): Promise<void> {
    this.logger.error(`Search ${searchId} aggregation failed: ${message}`)
    await this.emit(searchKey, { _tag: "Failed", kind: "Unknown", message }).catch(() => {})
    await repositories.searches.markFailed(this.dbClient.db, searchId).catch(() => {})
    await this.redis.expire(searchKey, STREAM_TTL_SEC).catch(() => {})
  }

  private async isCancelled(searchId: string): Promise<boolean> {
    return (await this.redis.get(searchCancelledKey(searchId))) !== null
  }

  private async emit(searchKey: string, event: unknown): Promise<void> {
    await this.redis.xadd(searchKey, "*", "data", JSON.stringify(event))
  }
}
