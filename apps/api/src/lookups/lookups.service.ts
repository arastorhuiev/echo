import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import { DB_CLIENT, REDIS } from "@echo/nest"
import { OsintProviderRegistry, queryHash } from "@echo/providers"
import { type LookupJobData, lookupCancelChannel, Q_LOOKUP } from "@echo/queue"
import { InjectQueue } from "@nestjs/bullmq"
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { Queue } from "bullmq"
import type { Redis } from "ioredis"

export interface EnqueueLookupInput {
  readonly providerId: string
  readonly query: unknown
  readonly ipAddress?: string | null
}

export interface EnqueueLookupResult {
  readonly id: string
  readonly streamUrl: string
}

export interface CancelLookupResult {
  readonly id: string
  readonly cancelRequested: boolean
  /**
   * The lookup's status at the moment cancel() was called. May be stale
   * by the time the response is read — the worker could have completed
   * or failed between our DB lookup and the publish. Callers wanting
   * the post-cancel status should re-GET the lookup.
   */
  readonly previousStatus: string
}

@Injectable()
export class LookupsService {
  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(Q_LOOKUP) private readonly queue: Queue,
    private readonly registry: OsintProviderRegistry,
  ) {}

  /**
   * Validate the payload against the provider's inputSchema, write a
   * `lookups` row in `queued` state, then enqueue a BullMQ job that
   * the worker's LookupProcessor will pick up and run.
   */
  async enqueue(input: EnqueueLookupInput): Promise<EnqueueLookupResult> {
    const provider = this.registry.get(input.providerId)
    if (!provider) {
      throw new BadRequestException({
        error: "UnknownProvider",
        providerId: input.providerId,
        knownProviders: this.registry.ids(),
      })
    }

    let parsedQuery: unknown
    try {
      parsedQuery = provider.inputSchema.parse(input.query)
    } catch (err) {
      throw new BadRequestException({
        error: "InvalidQuery",
        providerId: provider.id,
        details: err instanceof Error ? err.message : String(err),
      })
    }

    const lookup = await repositories.lookups.create(this.dbClient.db, {
      providerId: provider.id,
      queryHash: queryHash(parsedQuery),
      query: parsedQuery,
      ipAddress: input.ipAddress ?? null,
    })

    const jobData: LookupJobData = {
      lookupId: lookup.id,
      providerId: provider.id,
      query: parsedQuery,
    }
    await this.queue.add("lookup", jobData, {
      jobId: lookup.id,
      // Per-provider override of the queue-wide attempts default (3).
      // Used by deterministically-failing providers like stub-fail to
      // avoid pointless retries that just churn the lookups.status.
      ...(provider.defaults.attempts !== undefined ? { attempts: provider.defaults.attempts } : {}),
    })

    return {
      id: lookup.id,
      streamUrl: `/api/lookups/${lookup.id}/stream`,
    }
  }

  /**
   * Request cancellation of an in-flight lookup. Publishes a signal on
   * `lookup:cancel:<id>`; the worker's per-job subscriber wakes up and
   * fires the AbortController inside `LookupProcessor.process`. The
   * actual `markCancelled` happens in the worker once the abort lands —
   * this method only returns "request accepted" / "already terminal".
   */
  async cancel(id: string): Promise<CancelLookupResult> {
    const lookup = await repositories.lookups.findById(this.dbClient.db, id)
    if (!lookup) {
      throw new NotFoundException({ error: "LookupNotFound", id })
    }

    const isTerminal =
      lookup.status === "done" || lookup.status === "failed" || lookup.status === "cancelled"
    if (isTerminal) {
      return { id, cancelRequested: false, previousStatus: lookup.status }
    }

    await this.redis.publish(lookupCancelChannel(id), "1")
    return { id, cancelRequested: true, previousStatus: lookup.status }
  }

  findById(id: string) {
    return repositories.lookups.findById(this.dbClient.db, id)
  }
}
