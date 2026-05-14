import { type AppConfigService, ConfigModule } from "@echo/config"
import { buildLoggerConfig } from "@echo/observability"
import { OsintProviderRegistryModule, STUB_PROVIDERS } from "@echo/providers"
import { forRootBullModule } from "@echo/queue"
import { Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { LoggerModule as PinoLoggerModule } from "nestjs-pino"
import { DbModule } from "@/db/db.module"
import { EchoDemoModule } from "@/echo-demo/echo.module"
import { LookupsModule } from "@/lookups/lookups.module"
import { RedisModule } from "@/redis/redis.module"

const isProd = process.env.NODE_ENV === "production"

@Module({
  imports: [
    ConfigModule,
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) =>
        buildLoggerConfig({
          nodeEnv: config.get("NODE_ENV"),
          logLevel: config.get("LOG_LEVEL"),
        }),
    }),
    forRootBullModule(),
    OsintProviderRegistryModule.forRoot({ providers: STUB_PROVIDERS }),
    // Global clients — DB for persisting lookups + lookup_events; Redis
    // for the cache wrapper inside applyWrappers().
    DbModule,
    RedisModule,
    // Generic lookup processor — runs whatever the api enqueues.
    LookupsModule,
    // Demo processor — only attached in non-prod, in line with the api side.
    ...(isProd ? [] : [EchoDemoModule]),
  ],
})
export class AppModule {}
