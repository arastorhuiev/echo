import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createSocidExtractorProvider } from "@/socid-extractor/socid-extractor.js"

export const SOCID_EXTRACTOR_PROVIDER = Symbol.for("@echo/providers/SOCID_EXTRACTOR_PROVIDER")

@Module({})
export class SocidExtractorProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: SocidExtractorProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: SOCID_EXTRACTOR_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createSocidExtractorProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [SOCID_EXTRACTOR_PROVIDER],
    }
  }
}
