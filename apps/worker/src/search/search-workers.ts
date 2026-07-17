import type { AppConfigService } from "@echo/config"
import { bullConnection, Q_SEARCH, type SearchJobData } from "@echo/queue"
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { type Job, Worker } from "bullmq"
import { SearchAggregator } from "@/search/search-aggregator"

/**
 * How many search aggregations run at once. A search job is I/O-light (it
 * BLOCK-reads child streams); the real resource pressure is the child
 * lookups, which are already bounded by the per-provider queue caps and the
 * sidecar global-heavy semaphore. So this cap only bounds concurrent
 * fan-outs, not concurrent provider work.
 */
const SEARCH_CONCURRENCY = 8

/**
 * Consumer of the `q.search` orchestration queue (P12). One imperative
 * BullMQ Worker; every job delegates to the shared SearchAggregator.
 */
@Injectable()
export class SearchWorkers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchWorkers.name)
  private worker?: Worker

  constructor(
    private readonly aggregator: SearchAggregator,
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<SearchJobData>(
      Q_SEARCH,
      (job: Job<SearchJobData>) => this.aggregator.run(job),
      { connection: bullConnection(this.config.get("REDIS_URL")), concurrency: SEARCH_CONCURRENCY },
    )
    this.worker.on("error", (err) => this.logger.error(`Worker ${Q_SEARCH} error: ${err.message}`))
    this.logger.log(`Started search aggregator worker on ${Q_SEARCH}@${SEARCH_CONCURRENCY}`)
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}
