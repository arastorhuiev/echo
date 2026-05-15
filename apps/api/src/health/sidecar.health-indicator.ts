import type { AppConfigService } from "@echo/config"
import { Injectable } from "@nestjs/common"
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from "@nestjs/terminus"

@Injectable()
export class SidecarHealthIndicator extends HealthIndicator {
  constructor(private readonly config: AppConfigService) {
    super()
  }

  async ping(key: string): Promise<HealthIndicatorResult> {
    const url = this.config.get("OSINT_PY_URL")

    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!res.ok) {
        throw new Error(`sidecar returned ${res.status}`)
      }
      return this.getStatus(key, true)
    } catch (err) {
      throw new HealthCheckError(
        `${key} check failed`,
        this.getStatus(key, false, {
          message: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }
}
