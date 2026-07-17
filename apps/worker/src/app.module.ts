import { type AppConfigService, ConfigModule } from "@echo/config"
import { DbModule, RedisModule } from "@echo/nest"
import { buildLoggerConfig } from "@echo/observability"
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
import { LookupsModule } from "@/lookups/lookups.module"
import { SearchModule } from "@/search/search.module"

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
    // Provider registry mirrors the api side — see apps/api/src/app.module.ts
    // for why both sides register the same set.
    //
    // LOCKSTEP INVARIANT (P9b-core): the worker's provider set MUST be a
    // superset of the api's. With per-provider queues, the api enqueues to
    // `q.<id>` and only the worker's LookupWorkers creates a consuming
    // Worker; a provider the api can enqueue but the worker lacks would
    // leave its jobs `waiting` forever (no consumer, no terminal event).
    // Keep these two arrays identical. (Follow-up: derive both from one
    // shared list so they cannot drift.)
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
    // Global clients from @echo/nest — DB for persisting lookups +
    // lookup_events; Redis for the cache wrapper inside applyWrappers().
    DbModule,
    RedisModule,
    // Generic lookup processor — runs whatever the api enqueues.
    LookupsModule,
    // Search-orchestration aggregator — q.search consumer (P12).
    SearchModule,
  ],
})
export class AppModule {}
