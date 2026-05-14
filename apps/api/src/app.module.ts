import { type AppConfigService, ConfigModule } from "@echo/config"
import { buildLoggerConfig, MetricsModule } from "@echo/observability"
import { forRootBullModule } from "@echo/queue"
import { Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { LoggerModule as PinoLoggerModule } from "nestjs-pino"
import { DbModule } from "@/db/db.module"
import { EchoDemoModule } from "@/echo-demo/echo.module"
import { HealthModule } from "@/health/health.module"
import { MetricsController } from "@/metrics/metrics.controller"
import { RedisModule } from "@/redis/redis.module"

const isProd = process.env.NODE_ENV === "production"

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
    // BullMQ root — Redis connection shared across every per-provider queue
    forRootBullModule(),
    // Long-lived clients with shutdown hooks
    DbModule,
    RedisModule,
    // Feature modules
    HealthModule,
    // Prometheus registry (global module from @echo/observability)
    MetricsModule,
    // Internal demo queue endpoint — never exposed in production
    ...(isProd ? [] : [EchoDemoModule]),
  ],
  controllers: [MetricsController],
})
export class AppModule {}
