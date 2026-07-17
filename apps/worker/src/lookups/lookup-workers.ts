import type { AppConfigService } from "@echo/config"
import { OsintProviderRegistry } from "@echo/providers"
import { bullConnection, type LookupJobData, queueName } from "@echo/queue"
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { type Job, Worker } from "bullmq"
import { LookupRunner } from "@/lookups/lookup-runner"

/**
 * Consumer-side fan-out of the per-provider BullMQ queues (P9b-core).
 *
 * One imperative `Worker` per registered provider, bound to `q.<id>`
 * with `concurrency = provider.defaults.maxConcurrent`. That per-provider
 * cap is the mirror of the P9a sidecar `asyncio.Semaphore` — heavy
 * scrapers (maigret=2, sherlock=4) get low caps, light in-process
 * providers (phonenumbers=16) run wide. The sidecar's own global-heavy
 * semaphore remains the box-wide ceiling, so BullMQ never has to know
 * the global budget: an over-eager provider queue simply blocks on the
 * sidecar semaphore instead of OOMing the box.
 *
 * Built imperatively rather than via `@nestjs/bullmq`'s `@Processor`
 * because Nest binds exactly one processor class per queue at decoration
 * time; N runtime-resolved queues need N Workers created from the
 * registry. Every Worker delegates to the shared `LookupRunner`.
 */
@Injectable()
export class LookupWorkers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LookupWorkers.name)
  private readonly workers: Worker[] = []

  constructor(
    private readonly registry: OsintProviderRegistry,
    private readonly runner: LookupRunner,
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    const connection = bullConnection(this.config.get("REDIS_URL"))
    for (const provider of this.registry.list()) {
      const name = queueName(provider.id)
      const concurrency = provider.defaults.maxConcurrent
      const worker = new Worker<LookupJobData>(
        name,
        (job: Job<LookupJobData>) => this.runner.run(job),
        {
          connection,
          concurrency,
        },
      )
      worker.on("error", (err) => this.logger.error(`Worker ${name} error: ${err.message}`))
      this.workers.push(worker)
    }
    this.logger.log(
      `Started ${this.workers.length} per-provider workers: ${this.registry
        .list()
        .map((p) => `${queueName(p.id)}@${p.defaults.maxConcurrent}`)
        .join(", ")}`,
    )
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()))
  }
}
