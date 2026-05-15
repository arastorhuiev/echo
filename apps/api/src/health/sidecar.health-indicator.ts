import type { AppConfigService } from "@echo/config"
import { Injectable } from "@nestjs/common"
import { HealthIndicatorService } from "@nestjs/terminus"

@Injectable()
export class SidecarHealthIndicator {
  constructor(
    private readonly config: AppConfigService,
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
