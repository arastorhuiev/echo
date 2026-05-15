import type { DbClient } from "@echo/db/client"
import { DB_CLIENT } from "@echo/nest"
import { Inject, Injectable } from "@nestjs/common"
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from "@nestjs/terminus"

@Injectable()
export class PostgresHealthIndicator extends HealthIndicator {
  constructor(@Inject(DB_CLIENT) private readonly dbClient: DbClient) {
    super()
  }

  async ping(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.dbClient.ping()
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
