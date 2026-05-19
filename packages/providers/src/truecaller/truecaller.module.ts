import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createTruecallerProvider } from "@/truecaller/truecaller.js"

export const TRUECALLER_PROVIDER = Symbol.for("@echo/providers/TRUECALLER_PROVIDER")

@Module({})
export class TruecallerProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: TruecallerProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: TRUECALLER_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createTruecallerProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [TRUECALLER_PROVIDER],
    }
  }
}
