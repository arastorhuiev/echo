import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createTelegramResolveProvider } from "@/telegram-resolve/telegram-resolve.js"

export const TELEGRAM_RESOLVE_PROVIDER = Symbol.for("@echo/providers/TELEGRAM_RESOLVE_PROVIDER")

@Module({})
export class TelegramResolveProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: TelegramResolveProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: TELEGRAM_RESOLVE_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createTelegramResolveProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [TELEGRAM_RESOLVE_PROVIDER],
    }
  }
}
