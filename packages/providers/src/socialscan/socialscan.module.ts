import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createSocialscanProvider } from "@/socialscan/socialscan.js"

export const SOCIALSCAN_PROVIDER = Symbol.for("@echo/providers/SOCIALSCAN_PROVIDER")

@Module({})
export class SocialscanProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: SocialscanProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: SOCIALSCAN_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createSocialscanProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [SOCIALSCAN_PROVIDER],
    }
  }
}
