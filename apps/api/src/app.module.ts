import { type AppConfigService, ConfigModule } from "@echo/config"
import { DbModule, RedisModule } from "@echo/nest"
import { buildLoggerConfig, MetricsModule } from "@echo/observability"
import {
  EXIFTOOL_PROVIDER,
  ExiftoolProviderModule,
  GHUNT_PROVIDER,
  GhuntProviderModule,
  HIBP_PROVIDER,
  HibpProviderModule,
  HUDSONROCK_PROVIDER,
  HudsonRockProviderModule,
  IGNORANT_PROVIDER,
  IgnorantProviderModule,
  MAIGRET_PROVIDER,
  MAILCAT_PROVIDER,
  MaigretProviderModule,
  MailcatProviderModule,
  type OsintProvider,
  OsintProviderRegistryModule,
  PHONEINFOGA_PROVIDER,
  PHONENUMBERS_PROVIDER,
  PhoneinfogaProviderModule,
  PhonenumbersProviderModule,
  SHERLOCK_PROVIDER,
  SherlockProviderModule,
  SOCIALSCAN_PROVIDER,
  SOCID_EXTRACTOR_PROVIDER,
  SocialscanProviderModule,
  SocidExtractorProviderModule,
  STUB_PROVIDERS,
  TELEGRAM_RESOLVE_PROVIDER,
  TelegramResolveProviderModule,
  TRUECALLER_PROVIDER,
  TruecallerProviderModule,
  WHATSMYNAME_PROVIDER,
  WhatsmynameProviderModule,
} from "@echo/providers"
import { Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { LoggerModule as PinoLoggerModule } from "nestjs-pino"
import { AdminModule } from "@/admin/admin.module"
import { HealthModule } from "@/health/health.module"
import { LookupsModule } from "@/lookups/lookups.module"
import { MetricsController } from "@/metrics/metrics.controller"
import { ProvidersModule } from "@/providers-meta/providers.module"
import { SearchModule } from "@/search/search.module"

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
    // Provider registry — both api and worker register the same set so
    // input validation on the producer side matches what the consumer can run.
    // SherlockProviderModule (imported only here, scoped to the registry)
    // injects OSINT_PY_URL from ConfigService; stubs stay registered in
    // non-prod for end-to-end tests against the real pipeline.
    OsintProviderRegistryModule.forRootAsync({
      imports: [
        SherlockProviderModule.forRoot(),
        HibpProviderModule.forRoot(),
        HudsonRockProviderModule.forRoot(),
        WhatsmynameProviderModule.forRoot(),
        PhonenumbersProviderModule.forRoot(),
        MaigretProviderModule.forRoot(),
        SocialscanProviderModule.forRoot(),
        PhoneinfogaProviderModule.forRoot(),
        TelegramResolveProviderModule.forRoot(),
        TruecallerProviderModule.forRoot(),
        SocidExtractorProviderModule.forRoot(),
        IgnorantProviderModule.forRoot(),
        GhuntProviderModule.forRoot(),
        MailcatProviderModule.forRoot(),
        ExiftoolProviderModule.forRoot(),
      ],
      inject: [
        SHERLOCK_PROVIDER,
        HIBP_PROVIDER,
        HUDSONROCK_PROVIDER,
        WHATSMYNAME_PROVIDER,
        PHONENUMBERS_PROVIDER,
        MAIGRET_PROVIDER,
        SOCIALSCAN_PROVIDER,
        PHONEINFOGA_PROVIDER,
        TELEGRAM_RESOLVE_PROVIDER,
        TRUECALLER_PROVIDER,
        SOCID_EXTRACTOR_PROVIDER,
        IGNORANT_PROVIDER,
        GHUNT_PROVIDER,
        MAILCAT_PROVIDER,
        EXIFTOOL_PROVIDER,
      ],
      useFactory: (
        sherlock: OsintProvider,
        hibp: OsintProvider,
        hudsonrock: OsintProvider,
        whatsmyname: OsintProvider,
        phonenumbers: OsintProvider,
        maigret: OsintProvider,
        socialscan: OsintProvider,
        phoneinfoga: OsintProvider,
        telegramResolve: OsintProvider,
        truecaller: OsintProvider,
        socidExtractor: OsintProvider,
        ignorant: OsintProvider,
        ghunt: OsintProvider,
        mailcat: OsintProvider,
        exiftool: OsintProvider,
      ) => {
        const real = [
          sherlock,
          hibp,
          hudsonrock,
          whatsmyname,
          phonenumbers,
          maigret,
          socialscan,
          phoneinfoga,
          telegramResolve,
          truecaller,
          socidExtractor,
          ignorant,
          ghunt,
          mailcat,
          exiftool,
        ]
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
    // Search orchestration — /api/search fan-out (P12)
    SearchModule,
    // Ops cockpit — /admin JSON API (P13)
    AdminModule,
    // Prometheus registry (global module from @echo/observability)
    MetricsModule,
  ],
  controllers: [MetricsController],
})
export class AppModule {}
