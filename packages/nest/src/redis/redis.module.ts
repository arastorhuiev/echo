import type { AppConfigService } from "@echo/config"
import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Redis } from "ioredis"
import { REDIS } from "@/redis/tokens.js"

/**
 * Global module — exports `REDIS` (a singleton ioredis client) so
 * health checks and any feature module can inject it without
 * re-importing RedisModule.
 *
 * NOT shared with BullMQ's connection (BullMQ requires
 * `maxRetriesPerRequest: null` for blocking commands; this client uses
 * the safer default of 3). Pub/sub also can't share — those need their
 * own dedicated connections per consumer/producer.
 *
 * Tears down via `OnApplicationShutdown`.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (config: AppConfigService): Redis =>
        new Redis(config.get("REDIS_URL"), {
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        }),
      inject: [ConfigService],
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit()
  }
}
