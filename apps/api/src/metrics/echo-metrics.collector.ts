import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import type { BreakerState } from "@echo/db/schema"
import { DB_CLIENT, REDIS } from "@echo/nest"
import { Gauge, MetricsService } from "@echo/observability"
import { OsintProviderRegistry } from "@echo/providers"
import { costDay, providerCostKey } from "@echo/queue"
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common"
import type { Redis } from "ioredis"
import { QueueRouter } from "@/lookups/queue-router"

/** Prometheus numeric encoding of a breaker state (for `echo_breaker_state`). */
export function breakerGaugeValue(state: BreakerState): number {
  switch (state) {
    case "closed":
      return 0
    case "half_open":
      return 1
    case "open":
      return 2
  }
}

/**
 * Registers echo's custom Prometheus metrics (P10) on the shared registry as
 * PULL gauges: their `collect()` runs at scrape time and reads the SAME live
 * sources the ops cockpit `/api/admin/status` uses — per-provider queue depth
 * (QueueRouter), breaker state (DB), and daily cost (Redis). Pull avoids the
 * multi-process push problem: the api process scrapes cross-process signals
 * from Redis/Postgres directly instead of the worker needing its own endpoint.
 *
 * (OTLP trace export is already wired in `@echo/observability/instrumentation`;
 * per-run counters + custom worker spans are a follow-up that needs a worker
 * metrics endpoint.)
 */
@Injectable()
export class EchoMetricsCollector implements OnModuleInit {
  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly registry: OsintProviderRegistry,
    private readonly queues: QueueRouter,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    // prom-client binds `this` to the gauge inside `collect`, so the metric's
    // own deps are reached via `self` (the collector). collect() runs at
    // scrape time — a pull model, no cross-process push needed.
    const self = this
    const registers = [this.metrics.registry]

    new Gauge({
      name: "echo_queue_waiting",
      help: "BullMQ waiting jobs per provider queue",
      labelNames: ["provider"],
      registers,
      async collect() {
        const counts = await self.queues.jobCounts().catch(() => ({}))
        this.reset()
        for (const [provider, c] of Object.entries(counts)) {
          this.set({ provider }, Number(c.waiting ?? 0))
        }
      },
    })

    new Gauge({
      name: "echo_queue_active",
      help: "BullMQ active jobs per provider queue",
      labelNames: ["provider"],
      registers,
      async collect() {
        const counts = await self.queues.jobCounts().catch(() => ({}))
        this.reset()
        for (const [provider, c] of Object.entries(counts)) {
          this.set({ provider }, Number(c.active ?? 0))
        }
      },
    })

    new Gauge({
      name: "echo_breaker_state",
      help: "Circuit breaker state per provider (0=closed, 1=half_open, 2=open)",
      labelNames: ["provider"],
      registers,
      async collect() {
        const rows = await repositories.providers.list(self.dbClient.db).catch(() => [])
        this.reset()
        for (const row of rows) {
          this.set({ provider: row.id }, breakerGaugeValue(row.breakerState))
        }
      },
    })

    new Gauge({
      name: "echo_cost_total",
      help: "Per-provider run count for the current UTC day",
      labelNames: ["provider"],
      registers,
      async collect() {
        const ids = self.registry.ids()
        this.reset()
        if (ids.length === 0) return
        const day = costDay(new Date())
        const values = await self.redis
          .mget(ids.map((id) => providerCostKey(id, day)))
          .catch(() => [])
        ids.forEach((id, i) => {
          const v = values[i]
          if (v != null) this.set({ provider: id }, Number(v))
        })
      },
    })
  }
}
