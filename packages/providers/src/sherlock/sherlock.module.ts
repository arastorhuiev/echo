import { type AppConfigService, ConfigModule } from "@echo/config"
import { type DynamicModule, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { createSherlockProvider } from "@/sherlock/sherlock.js"

/**
 * DI token for the SherlockProvider singleton. The token lives here (not
 * in tokens.ts) because the provider is the only export of this module —
 * keep them co-located until a second token shows up.
 */
export const SHERLOCK_PROVIDER = Symbol.for("@echo/providers/SHERLOCK_PROVIDER")

/**
 * Wires `OSINT_PY_URL` from `@echo/config` into a Sherlock provider
 * instance. AppModules consume the singleton via:
 *
 *   imports: [SherlockProviderModule.forRoot()]
 *   ...
 *   useFactory: (sherlock) => ({ providers: [sherlock, ...] }),
 *   inject: [SHERLOCK_PROVIDER]
 */
@Module({})
export class SherlockProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: SherlockProviderModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: SHERLOCK_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: AppConfigService) =>
            createSherlockProvider({ sidecarUrl: config.get("OSINT_PY_URL") }),
        },
      ],
      exports: [SHERLOCK_PROVIDER],
    }
  }
}
