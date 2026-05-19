import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createMailcatProvider } from "@/mailcat/mailcat.js"

export const MAILCAT_PROVIDER = Symbol.for("@echo/providers/MAILCAT_PROVIDER")

@Module({})
export class MailcatProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: MailcatProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: MAILCAT_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createMailcatProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [MAILCAT_PROVIDER],
    }
  }
}
