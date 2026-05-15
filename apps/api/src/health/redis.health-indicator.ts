import { REDIS } from "@echo/nest"
import { Inject, Injectable } from "@nestjs/common"
import { HealthIndicatorService } from "@nestjs/terminus"
import type { Redis } from "ioredis"

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly health: HealthIndicatorService,
  ) {}

  async ping(key: string) {
    const indicator = this.health.check(key)
    try {
      const reply = await this.redis.ping()
      if (reply !== "PONG") {
        return indicator.down({ message: `unexpected PING reply: ${reply}` })
      }
      return indicator.up()
    } catch (err) {
      return indicator.down({
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
