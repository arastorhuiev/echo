import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createMaigretProvider } from "@/maigret/maigret.js"

export const MAIGRET_PROVIDER = Symbol.for("@echo/providers/MAIGRET_PROVIDER")

@Module({})
export class MaigretProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: MaigretProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: MAIGRET_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createMaigretProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [MAIGRET_PROVIDER],
    }
  }
}
