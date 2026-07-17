import type { AppConfigService } from "@echo/config"
import { OsintProviderRegistry } from "@echo/providers"
import { bullConnection, defaultQueueOptions, queueName } from "@echo/queue"
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Queue } from "bullmq"

/**
 * Producer-side fan-out of the per-provider BullMQ queues (P9b-core).
 *
 * One `Queue` per registered provider, named `q.<providerId>`. The api
 * routes each enqueue to the provider's own queue so the worker can cap
 * concurrency independently per provider (heavy sidecar scrapers stay
 * low; light in-process providers run wide) instead of everything
 * sharing a single `q.lookup` throttle.
 *
 * Built imperatively rather than via `@nestjs/bullmq`'s
 * `registerQueue`/`@InjectQueue` because the provider set is only known
 * at runtime (resolved from the registry), not at module-decoration
 * time. Closed on shutdown via `onModuleDestroy`.
 */
@Injectable()
export class QueueRouter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueRouter.name)
  private readonly queues = new Map<string, Queue>()

  constructor(
    private readonly registry: OsintProviderRegistry,
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    const connection = bullConnection(this.config.get("REDIS_URL"))
    for (const provider of this.registry.list()) {
      const { name, defaultJobOptions } = defaultQueueOptions({ providerId: provider.id })
      const queue = new Queue(name, { connection, defaultJobOptions })
      // Producer queues emit `error` on connection trouble; BullMQ swallows
      // an unhandled one to console.error, so attach a real logger.
      queue.on("error", (err) => this.logger.error(`Queue ${name} error: ${err.message}`))
      this.queues.set(provider.id, queue)
    }
    this.logger.log(
      `Initialised ${this.queues.size} per-provider queues: ${this.registry
        .ids()
        .map(queueName)
        .join(", ")}`,
    )
  }

  /** Whether a queue is registered for `providerId`. */
  has(providerId: string): boolean {
    return this.queues.has(providerId)
  }

  /** The per-provider queue for `providerId`. Throws for unknown providers. */
  get(providerId: string): Queue {
    const queue = this.queues.get(providerId)
    if (!queue) throw new Error(`No queue registered for provider "${providerId}"`)
    return queue
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()))
  }
}
