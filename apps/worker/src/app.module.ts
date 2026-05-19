import { type AppConfigService, ConfigModule } from "@echo/config"
import { DbModule, RedisModule } from "@echo/nest"
import { buildLoggerConfig } from "@echo/observability"
import {
  EMAILREP_PROVIDER,
  EmailrepProviderModule,
  GHUNT_PROVIDER,
  GhuntProviderModule,
  GRAVATAR_PROVIDER,
  GravatarProviderModule,
  HIBP_PROVIDER,
  HibpProviderModule,
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
import { forRootBullModule } from "@echo/queue"
import { Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { LoggerModule as PinoLoggerModule } from "nestjs-pino"
import { LookupsModule } from "@/lookups/lookups.module"

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
    // Provider registry mirrors the api side — see apps/api/src/app.module.ts
    // for why both sides register the same set.
    OsintProviderRegistryModule.forRootAsync({
      imports: [
        SherlockProviderModule.forRoot(),
        GravatarProviderModule.forRoot(),
        HibpProviderModule.forRoot(),
        EmailrepProviderModule.forRoot(),
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
      ],
      inject: [
        SHERLOCK_PROVIDER,
        GRAVATAR_PROVIDER,
        HIBP_PROVIDER,
        EMAILREP_PROVIDER,
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
      ],
      useFactory: (
        sherlock: OsintProvider,
        gravatar: OsintProvider,
        hibp: OsintProvider,
        emailrep: OsintProvider,
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
      ) => {
        const real = [
          sherlock,
          gravatar,
          hibp,
          emailrep,
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
  ],
})
export class AppModule {}
