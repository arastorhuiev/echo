import type { DbClient } from "@echo/db/client"
import { DB_CLIENT } from "@echo/nest"
import { Inject, Injectable } from "@nestjs/common"
import { HealthIndicatorService } from "@nestjs/terminus"

@Injectable()
export class PostgresHealthIndicator {
  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
    private readonly health: HealthIndicatorService,
  ) {}

  async ping(key: string) {
    const indicator = this.health.check(key)
    try {
      await this.dbClient.ping()
      return indicator.up()
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
