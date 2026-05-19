import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createPhonenumbersProvider } from "@/phonenumbers/phonenumbers.js"

export const PHONENUMBERS_PROVIDER = Symbol.for("@echo/providers/PHONENUMBERS_PROVIDER")

@Module({})
export class PhonenumbersProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: PhonenumbersProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: PHONENUMBERS_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createPhonenumbersProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [PHONENUMBERS_PROVIDER],
    }
  }
}
