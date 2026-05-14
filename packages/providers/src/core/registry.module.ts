import { type DynamicModule, Module } from "@nestjs/common"
import type { OsintProvider } from "@/core/provider.js"
import { OSINT_PROVIDERS_TOKEN, OsintProviderRegistry } from "@/core/registry.js"

export interface OsintProviderRegistryModuleInput {
  readonly providers: readonly OsintProvider[]
}

/**
 * Global module that exposes `OsintProviderRegistry` to every other
 * module in the app graph. Both apps/api and apps/worker register the
 * same provider set so they have the same view of inputSchemas etc.
 *
 * Usage:
 *   imports: [
 *     OsintProviderRegistryModule.forRoot({
 *       providers: [stubSuccessProvider, stubFailProvider, ...],
 *     }),
 *   ]
 */
@Module({})
export class OsintProviderRegistryModule {
  static forRoot(input: OsintProviderRegistryModuleInput): DynamicModule {
    return {
      module: OsintProviderRegistryModule,
      global: true,
      providers: [
        { provide: OSINT_PROVIDERS_TOKEN, useValue: input.providers },
        OsintProviderRegistry,
      ],
      exports: [OsintProviderRegistry],
    }
  }
}
