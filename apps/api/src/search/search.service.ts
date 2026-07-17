import type { AppConfigService } from "@echo/config"
import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import { DB_CLIENT, REDIS } from "@echo/nest"
import { OsintProviderRegistry, queryHash } from "@echo/providers"
import {
  bullConnection,
  type LookupJobData,
  lookupCancelChannel,
  lookupCancelledKey,
  Q_SEARCH,
  type SearchJobData,
  searchCancelledKey,
  searchEventsKey,
} from "@echo/queue"
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { type Job, Queue } from "bullmq"
import type { Redis } from "ioredis"
import { QueueRouter } from "@/lookups/queue-router"
import { applicableTargets } from "@/search/applicability"
import { classifyIdentifier } from "@/search/classify"

const CANCEL_FLAG_TTL_SEC = 60 * 60
const STREAM_TTL_SEC = 60 * 60
const REMOVABLE_STATES: ReadonlySet<string> = new Set([
  "waiting",
  "delayed",
  "prioritized",
  "waiting-children",
  "paused",
])

export interface CreateSearchInput {
  readonly identifier: string
  readonly ipAddress?: string | null
}

export interface CreateSearchResult {
  readonly id: string
  readonly kind: string
  readonly streamUrl: string
  /** Provider ids the search fanned out to (empty ⇒ unsupported / nothing applicable). */
  readonly targets: string[]
}

export interface CancelSearchResult {
  readonly id: string
  readonly cancelRequested: boolean
  readonly previousStatus: string
}

/**
 * Orchestration entrypoint (P12). Classifies an identifier, fans it out to
 * every applicable + enabled provider as child lookups (each a real
 * per-provider run linked by `search_id`), and enqueues one aggregator job
 * on `q.search`. Cancellation cascades to every child.
 */
@Injectable()
export class SearchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchService.name)
  private searchQueue!: Queue

  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly registry: OsintProviderRegistry,
    @Inject(ConfigService) private readonly config: AppConfigService,
    private readonly queues: QueueRouter,
  ) {}

  onModuleInit(): void {
    this.searchQueue = new Queue(Q_SEARCH, {
      connection: bullConnection(this.config.get("REDIS_URL")),
    })
    this.searchQueue.on("error", (err) =>
      this.logger.error(`Queue ${Q_SEARCH} error: ${err.message}`),
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.searchQueue.close()
  }

  async createSearch(input: CreateSearchInput): Promise<CreateSearchResult> {
    const identifier = input.identifier.trim()
    if (!identifier) {
      throw new BadRequestException({ error: "EmptyIdentifier" })
    }

    const kind = classifyIdentifier(identifier)
    const search = await repositories.searches.create(this.dbClient.db, { identifier, kind })

    // Paywall stamp (P14). The EntitlementGuard on POST /api/search already
    // allowed this request, so record the search paid; its children run via
    // the internal path and inherit entitlement from the parent.
    await repositories.searches.markPaid(this.dbClient.db, search.id)

    // Resolve applicable targets: present in the registry, enabled, and whose
    // built query passes the provider's inputSchema.
    const children: Array<{ providerId: string; query: unknown }> = []
    for (const target of applicableTargets(kind, identifier)) {
      const provider = this.registry.get(target.providerId)
      if (!provider) continue
      if (!(await repositories.providers.isEnabled(this.dbClient.db, provider.id))) continue
      const parsed = provider.inputSchema.safeParse(target.query)
      if (!parsed.success) continue
      children.push({ providerId: provider.id, query: parsed.data })
    }

    if (children.length === 0) {
      // domain/unsupported, or every applicable provider disabled/absent.
      const report = {
        identifier,
        kind,
        unsupported: kind === "domain",
        providersRun: 0,
        providersSucceeded: 0,
        providersFailed: 0,
        accounts: [],
        providers: [],
      }
      await repositories.searches.markDone(this.dbClient.db, search.id, report)
      await this.emitTerminal(search.id, { _tag: "Final", data: report })
      return { id: search.id, kind, streamUrl: this.streamUrl(search.id), targets: [] }
    }

    // Fan out: create + enqueue each child, then the aggregator job LAST. If
    // anything throws mid-fan-out (Redis/DB blip), some children may already
    // be enqueued (they run as harmless orphans), but there'd be no
    // aggregator — so mark the search failed and emit a terminal to close any
    // connected stream, then surface the error to the caller.
    try {
      const childRefs: SearchJobData["children"][number][] = []
      for (const child of children) {
        const provider = this.registry.getOrThrow(child.providerId)
        const lookup = await repositories.lookups.create(this.dbClient.db, {
          providerId: provider.id,
          queryHash: queryHash(child.query),
          query: child.query,
          ipAddress: input.ipAddress ?? null,
          searchId: search.id,
        })
        const jobData: LookupJobData = {
          lookupId: lookup.id,
          providerId: provider.id,
          query: child.query,
        }
        await this.queues.get(provider.id).add("lookup", jobData, {
          jobId: lookup.id,
          ...(provider.defaults.attempts !== undefined
            ? { attempts: provider.defaults.attempts }
            : {}),
        })
        childRefs.push({ lookupId: lookup.id, providerId: provider.id })
      }

      const searchJob: SearchJobData = { searchId: search.id, children: childRefs }
      await this.searchQueue.add("search", searchJob, { jobId: search.id })

      return {
        id: search.id,
        kind,
        streamUrl: this.streamUrl(search.id),
        targets: childRefs.map((c) => c.providerId),
      }
    } catch (err) {
      await repositories.searches.markFailed(this.dbClient.db, search.id).catch(() => {})
      await this.emitTerminal(search.id, {
        _tag: "Failed",
        kind: "Unknown",
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      throw err
    }
  }

  /** Cascade-cancel: stop the aggregator and every child (waiting or running). */
  async cancel(id: string): Promise<CancelSearchResult> {
    const search = await repositories.searches.findById(this.dbClient.db, id)
    if (!search) throw new NotFoundException({ error: "SearchNotFound", id })

    const isTerminal =
      search.status === "done" || search.status === "failed" || search.status === "cancelled"
    if (isTerminal) return { id, cancelRequested: false, previousStatus: search.status }

    // Persist the search cancel flag first so the aggregator aborts even if it
    // hasn't started; then cascade to each child (the P9b-core per-lookup flag
    // guarantees a still-`waiting` child never enters process()).
    await this.redis.set(searchCancelledKey(id), "1", "EX", CANCEL_FLAG_TTL_SEC)

    const childRows = await repositories.lookups.bySearch(this.dbClient.db, id)
    for (const child of childRows) {
      await this.redis.set(lookupCancelledKey(child.id), "1", "EX", CANCEL_FLAG_TTL_SEC)
      await this.removeIfWaiting(
        this.queues.has(child.providerId) ? this.queues.get(child.providerId) : undefined,
        child.id,
      )
      await this.redis.publish(lookupCancelChannel(child.id), "1")
    }

    // If the aggregator job hasn't started, it will never run — finalize here.
    const searchJob = await this.searchQueue.getJob(id)
    if (searchJob && REMOVABLE_STATES.has(await searchJob.getState())) {
      try {
        await searchJob.remove()
        await this.emitTerminal(id, { _tag: "Cancelled" })
        await repositories.searches.markCancelled(this.dbClient.db, id)
      } catch {
        // Raced to active — the running aggregator sees the flag and finalizes.
      }
    }

    return { id, cancelRequested: true, previousStatus: search.status }
  }

  findById(id: string) {
    return repositories.searches.findById(this.dbClient.db, id)
  }

  private async removeIfWaiting(queue: Queue | undefined, jobId: string): Promise<void> {
    if (!queue) return
    const job: Job | undefined = await queue.getJob(jobId)
    if (job && REMOVABLE_STATES.has(await job.getState())) {
      await job.remove().catch(() => {})
    }
  }

  private async emitTerminal(searchId: string, event: unknown): Promise<void> {
    const key = searchEventsKey(searchId)
    await this.redis.xadd(key, "*", "data", JSON.stringify(event))
    await this.redis.expire(key, STREAM_TTL_SEC)
  }

  private streamUrl(searchId: string): string {
    return `/api/search/${searchId}/stream`
  }
}
