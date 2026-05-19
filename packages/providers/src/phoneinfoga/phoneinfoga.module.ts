import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createPhoneinfogaProvider } from "@/phoneinfoga/phoneinfoga.js"

export const PHONEINFOGA_PROVIDER = Symbol.for("@echo/providers/PHONEINFOGA_PROVIDER")

@Module({})
export class PhoneinfogaProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: PhoneinfogaProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: PHONEINFOGA_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createPhoneinfogaProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [PHONEINFOGA_PROVIDER],
    }
  }
}
