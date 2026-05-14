import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import { OsintProviderRegistry, queryHash } from "@echo/providers"
import { type LookupJobData, Q_LOOKUP } from "@echo/queue"
import { InjectQueue } from "@nestjs/bullmq"
import { BadRequestException, Inject, Injectable } from "@nestjs/common"
import type { Queue } from "bullmq"
import { DB_CLIENT } from "@/db/tokens"

export interface EnqueueLookupInput {
  readonly providerId: string
  readonly query: unknown
  readonly ipAddress?: string | null
}

export interface EnqueueLookupResult {
  readonly id: string
  readonly streamUrl: string
}

@Injectable()
export class LookupsService {
  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
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
    await this.queue.add("lookup", jobData, { jobId: lookup.id })

    return {
      id: lookup.id,
      // SSE endpoint lands in P6; the URL is committed-to here so clients
      // can poll-then-stream once available.
      streamUrl: `/api/lookups/${lookup.id}/stream`,
    }
  }

  findById(id: string) {
    return repositories.lookups.findById(this.dbClient.db, id)
  }
}
