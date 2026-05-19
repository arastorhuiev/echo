import { type AppConfigService, ConfigModule } from "@echo/config"
import { DbModule, RedisModule } from "@echo/nest"
import { buildLoggerConfig, MetricsModule } from "@echo/observability"
import {
  EMAILREP_PROVIDER,
  EmailrepProviderModule,
  GRAVATAR_PROVIDER,
  GravatarProviderModule,
  HIBP_PROVIDER,
  HibpProviderModule,
  type OsintProvider,
  OsintProviderRegistryModule,
  SHERLOCK_PROVIDER,
  SherlockProviderModule,
  STUB_PROVIDERS,
  WHATSMYNAME_PROVIDER,
  WhatsmynameProviderModule,
} from "@echo/providers"
import { forRootBullModule } from "@echo/queue"
import { Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { LoggerModule as PinoLoggerModule } from "nestjs-pino"
import { HealthModule } from "@/health/health.module"
import { LookupsModule } from "@/lookups/lookups.module"
import { MetricsController } from "@/metrics/metrics.controller"
import { ProvidersModule } from "@/providers-meta/providers.module"

const isProd = process.env.NODE_ENV === "production"

@Module({
  imports: [
    // Validates process.env (zod) and is global
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
    // Provider registry — both api and worker register the same set so
    // input validation on the producer side matches what the consumer can run.
    // SherlockProviderModule (imported only here, scoped to the registry)
    // injects OSINT_PY_URL from ConfigService; stubs stay registered in
    // non-prod for end-to-end tests against the real pipeline.
    OsintProviderRegistryModule.forRootAsync({
      imports: [
        SherlockProviderModule.forRoot(),
        GravatarProviderModule.forRoot(),
        HibpProviderModule.forRoot(),
        EmailrepProviderModule.forRoot(),
        WhatsmynameProviderModule.forRoot(),
      ],
      inject: [
        SHERLOCK_PROVIDER,
        GRAVATAR_PROVIDER,
        HIBP_PROVIDER,
        EMAILREP_PROVIDER,
        WHATSMYNAME_PROVIDER,
      ],
      useFactory: (
        sherlock: OsintProvider,
        gravatar: OsintProvider,
        hibp: OsintProvider,
        emailrep: OsintProvider,
        whatsmyname: OsintProvider,
      ) => {
        const real = [sherlock, gravatar, hibp, emailrep, whatsmyname]
        return isProd ? real : [...real, ...STUB_PROVIDERS]
      },
    }),
    // Long-lived clients — both global from @echo/nest, with shutdown hooks
    DbModule,
    RedisModule,
    // Feature modules
    HealthModule,
    LookupsModule,
    ProvidersModule,
    // Prometheus registry (global module from @echo/observability)
    MetricsModule,
  ],
  controllers: [MetricsController],
})
export class AppModule {}
