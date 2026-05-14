import type { AppConfigService } from "@echo/config"
import { BullModule } from "@nestjs/bullmq"
import type { DynamicModule } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"

/**
 * BullMQ root module wired to our @echo/config-provided REDIS_URL.
 *
 * Note `maxRetriesPerRequest: null` — BullMQ workers use blocking Redis
 * commands (BRPOPLPUSH); ioredis would otherwise time out and surface
 * "command not allowed when used by Bull" errors.
 *
 * Both apps/api (producer) and apps/worker (consumer) call this exactly
 * once at the AppModule level.
 */
export function forRootBullModule(): DynamicModule {
  return BullModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: AppConfigService) => ({
      connection: {
        url: config.get("REDIS_URL"),
        maxRetriesPerRequest: null,
      },
    }),
  })
}
