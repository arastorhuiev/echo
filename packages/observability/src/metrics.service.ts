import { Injectable } from "@nestjs/common"
import { collectDefaultMetrics, Registry } from "prom-client"

/**
 * Single Prometheus registry shared across the app. Default Node + process
 * metrics (cpu, memory, event loop) are collected automatically; custom
 * counters / histograms / gauges should register themselves on
 * `metricsService.registry` from their owning modules.
 */
@Injectable()
export class MetricsService {
  readonly registry: Registry

  constructor() {
    this.registry = new Registry()
    collectDefaultMetrics({ register: this.registry })
  }

  metrics(): Promise<string> {
    return this.registry.metrics()
  }

  contentType(): string {
    return this.registry.contentType
  }
}
