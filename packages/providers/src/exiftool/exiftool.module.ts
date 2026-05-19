import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createExiftoolProvider } from "@/exiftool/exiftool.js"

export const EXIFTOOL_PROVIDER = Symbol.for("@echo/providers/EXIFTOOL_PROVIDER")

@Module({})
export class ExiftoolProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: ExiftoolProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: EXIFTOOL_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createExiftoolProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [EXIFTOOL_PROVIDER],
    }
  }
}
