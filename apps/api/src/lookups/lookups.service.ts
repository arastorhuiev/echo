import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import { DB_CLIENT, REDIS } from "@echo/nest"
import { OsintProviderRegistry, queryHash } from "@echo/providers"
import {
  type LookupJobData,
  lookupCancelChannel,
  lookupCancelledKey,
  lookupEventsKey,
} from "@echo/queue"
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common"
import type { Redis } from "ioredis"
import { QueueRouter } from "@/lookups/queue-router"

/** Cancel flag TTL — long enough to outlive any queued job's wait. */
const CANCEL_FLAG_TTL_SEC = 60 * 60
/** SSE replay window after a terminal event (matches the worker). */
const STREAM_TTL_SEC = 60 * 60
/** BullMQ states a job can be removed from — i.e. not yet locked by a worker. */
const REMOVABLE_STATES: ReadonlySet<string> = new Set([
  "waiting",
  "delayed",
  "prioritized",
  "waiting-children",
  "paused",
])

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
    private readonly queues: QueueRouter,
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

    // Admin load-shed gate (P13 D2): a provider disabled via
    // POST /admin/providers/:id/enabled rejects new work before we write a
    // row or burn a queue slot. Absence of a row ⇒ enabled (default true).
    if (!(await repositories.providers.isEnabled(this.dbClient.db, provider.id))) {
      throw new ServiceUnavailableException({
        error: "ProviderDisabled",
        providerId: provider.id,
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

    // Paywall stamp (P14). This is the gated public path — reaching here means
    // the EntitlementGuard on POST /api/lookups already allowed the request,
    // so record it paid. (Orchestration children bypass enqueue, so they are
    // never stamped here — the parent search carries the paid marker.)
    await repositories.lookups.markPaid(this.dbClient.db, lookup.id)

    const jobData: LookupJobData = {
      lookupId: lookup.id,
      providerId: provider.id,
      query: parsedQuery,
    }
    await this.queues.get(provider.id).add("lookup", jobData, {
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

    // Persist a cancel flag first: it guarantees the worker aborts even in
    // the race between here and job.remove() (the cancel-while-queued fix).
    await this.redis.set(lookupCancelledKey(id), "1", "EX", CANCEL_FLAG_TTL_SEC)

    // If the job hasn't started, drop it from the queue so it never occupies
    // a slot, and emit the terminal Cancelled ourselves (the worker won't).
    // The job lives on its provider's own queue (`q.<providerId>`). If that
    // provider was de-registered since enqueue, skip straight to the pub/sub
    // path rather than 500 — the persisted flag already guarantees abort.
    const job = this.queues.has(lookup.providerId)
      ? await this.queues.get(lookup.providerId).getJob(id)
      : undefined
    if (job && REMOVABLE_STATES.has(await job.getState())) {
      try {
        await job.remove()
        await this.emitCancelledTerminal(id)
        return { id, cancelRequested: true, previousStatus: lookup.status }
      } catch {
        // Raced to `active` as we removed it — fall through to the pub/sub
        // path; the worker's per-job subscriber + the flag handle it.
      }
    }

    await this.redis.publish(lookupCancelChannel(id), "1")
    return { id, cancelRequested: true, previousStatus: lookup.status }
  }

  /**
   * Terminal Cancelled event for a job removed before it ran — mirrors the
   * worker's handleCancellation so SSE consumers and the DB reflect the
   * cancellation of a never-started lookup.
   */
  private async emitCancelledTerminal(lookupId: string): Promise<void> {
    const event = { _tag: "Cancelled" as const }
    await repositories.lookupEvents.append(this.dbClient.db, lookupId, 1, event)
    await this.redis.xadd(lookupEventsKey(lookupId), "*", "data", JSON.stringify(event))
    await this.redis.expire(lookupEventsKey(lookupId), STREAM_TTL_SEC)
    await repositories.lookups.markCancelled(this.dbClient.db, lookupId)
  }

  findById(id: string) {
    return repositories.lookups.findById(this.dbClient.db, id)
  }
}
