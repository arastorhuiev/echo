import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createGhuntProvider } from "@/ghunt/ghunt.js"

export const GHUNT_PROVIDER = Symbol.for("@echo/providers/GHUNT_PROVIDER")

@Module({})
export class GhuntProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: GhuntProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: GHUNT_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createGhuntProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [GHUNT_PROVIDER],
    }
  }
}
