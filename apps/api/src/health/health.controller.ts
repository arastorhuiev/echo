import { Controller, Get } from "@nestjs/common"
import { HealthCheck, HealthCheckService } from "@nestjs/terminus"
import { PostgresHealthIndicator } from "@/health/postgres.health-indicator"
import { RedisHealthIndicator } from "@/health/redis.health-indicator"
import { SidecarHealthIndicator } from "@/health/sidecar.health-indicator"

@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: PostgresHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly sidecar: SidecarHealthIndicator,
  ) {}

  /** Liveness — process is responsive. Always 200 unless the event loop is wedged. */
  @Get("live")
  live(): { status: "live" } {
    return { status: "live" }
  }

  /** Readiness — can we accept traffic? Postgres + Redis must be reachable. */
  @Get("ready")
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.postgres.ping("postgres"),
      () => this.redis.ping("redis"),
      () => this.sidecar.ping("sidecar"),
    ])
  }
}
