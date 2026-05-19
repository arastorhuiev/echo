import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createIgnorantProvider } from "@/ignorant/ignorant.js"

export const IGNORANT_PROVIDER = Symbol.for("@echo/providers/IGNORANT_PROVIDER")

@Module({})
export class IgnorantProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: IgnorantProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: IGNORANT_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createIgnorantProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [IGNORANT_PROVIDER],
    }
  }
}
