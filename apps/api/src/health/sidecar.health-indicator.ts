import type { AppConfigService } from "@echo/config"
import { Inject, Injectable } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { HealthIndicatorService } from "@nestjs/terminus"

@Injectable()
export class SidecarHealthIndicator {
  constructor(
    // `AppConfigService` is a type alias over `ConfigService<EnvSchema, true>`.
    // It erases to `Object` in decorator metadata, so Nest needs the
    // explicit @Inject token to resolve the DI graph at runtime.
    @Inject(ConfigService) private readonly config: AppConfigService,
    private readonly health: HealthIndicatorService,
  ) {}

  async ping(key: string) {
    const indicator = this.health.check(key)
    const url = this.config.get("OSINT_PY_URL").replace(/\/+$/, "")
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })
      if (!res.ok) {
        return indicator.down({ message: `sidecar returned ${res.status}` })
      }
      return indicator.up()
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
