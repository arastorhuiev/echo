import type { AppConfigService } from "@echo/config"
import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Redis } from "ioredis"
import { REDIS } from "@/redis/tokens"

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
