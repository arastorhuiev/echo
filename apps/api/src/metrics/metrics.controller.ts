import { MetricsService } from "@echo/observability"
import { Controller, Get, Header } from "@nestjs/common"

@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /**
   * Prometheus exposition. Allowlist enforcement is a TODO for P11 (deploy);
   * locally + in CI this is open, in production it should sit behind the
   * `METRICS_ALLOWLIST` env var (CSV of CIDRs) at the reverse proxy.
   */
  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4")
  metrics_(): Promise<string> {
    return this.metrics.metrics()
  }
}
