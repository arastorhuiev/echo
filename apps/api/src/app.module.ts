import { type AppConfigService, ConfigModule } from "@echo/config"
import { buildLoggerConfig, MetricsModule } from "@echo/observability"
import { Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { LoggerModule as PinoLoggerModule } from "nestjs-pino"
import { DbModule } from "@/db/db.module"
import { HealthModule } from "@/health/health.module"
import { MetricsController } from "@/metrics/metrics.controller"
import { RedisModule } from "@/redis/redis.module"

@Module({
  imports: [
    // Validates process.env (zod) and is global, so any module can inject ConfigService
    ConfigModule,
    // Structured JSON logging in prod, pino-pretty in dev; auto request id
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) =>
        buildLoggerConfig({
          nodeEnv: config.get("NODE_ENV"),
          logLevel: config.get("LOG_LEVEL"),
        }),
    }),
    // Long-lived clients with shutdown hooks
    DbModule,
    RedisModule,
    // Feature modules
    HealthModule,
    // Prometheus registry (global module from @echo/observability)
    MetricsModule,
  ],
  controllers: [MetricsController],
})
export class AppModule {}
