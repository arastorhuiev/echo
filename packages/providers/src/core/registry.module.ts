import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type ModuleMetadata,
} from "@nestjs/common"
import type { OsintProvider } from "@/core/provider.js"
import { OSINT_PROVIDERS_TOKEN, OsintProviderRegistry } from "@/core/registry.js"

export interface OsintProviderRegistryModuleAsyncInput extends Pick<ModuleMetadata, "imports"> {
  readonly inject: readonly InjectionToken[]
  // NestJS's own async-factory pattern uses `any[]` for args because the
  // factory parameter types come from whatever the `inject` tokens
  // resolve to — there's no way to encode that as a strict tuple without
  // a much heavier generic signature. Callers cast at the call site.
  readonly useFactory: (
    ...args: any[]
  ) => Promise<readonly OsintProvider[]> | readonly OsintProvider[]
}

/**
 * Global module that exposes `OsintProviderRegistry` to every other
 * module in the app graph. Both apps/api and apps/worker register the
 * same provider set so they have the same view of inputSchemas etc.
 *
 * Async-only: real providers (Sherlock, …) need DI-resolved values
 * (`OSINT_PY_URL` from `ConfigService`). Stub-only registration for
 * tests just feeds a constant array through the same async factory.
 */
@Module({})
export class OsintProviderRegistryModule {
  static forRootAsync(input: OsintProviderRegistryModuleAsyncInput): DynamicModule {
    return {
      module: OsintProviderRegistryModule,
      global: true,
      imports: input.imports ?? [],
      providers: [
        {
          provide: OSINT_PROVIDERS_TOKEN,
          inject: [...input.inject],
          useFactory: input.useFactory,
        },
        OsintProviderRegistry,
      ],
      exports: [OsintProviderRegistry],
    }
  }
}
