import { REDIS } from "@echo/nest"
import { Inject, Injectable } from "@nestjs/common"
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from "@nestjs/terminus"
import type { Redis } from "ioredis"

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS) private readonly redis: Redis) {
    super()
  }

  async ping(key: string): Promise<HealthIndicatorResult> {
    try {
      const reply = await this.redis.ping()
      if (reply !== "PONG") {
        throw new Error(`unexpected PING reply: ${reply}`)
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
