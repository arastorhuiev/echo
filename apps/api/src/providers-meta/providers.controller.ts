import {
  OsintProviderRegistry,
  type ProviderCategory,
  type ProviderDefaults,
} from "@echo/providers"
import { Controller, Get } from "@nestjs/common"

interface ProviderMetadata {
  readonly id: string
  readonly category: ProviderCategory
  readonly defaults: ProviderDefaults
}

@Controller("providers")
export class ProvidersController {
  constructor(private readonly registry: OsintProviderRegistry) {}

  /**
   * Lists every registered provider with its category and runtime
   * defaults. Used by clients to discover what they can lookup.
   * inputSchema isn't serialised here — that comes via OpenAPI in P3+
   * once we wire each provider's DTO into @nestjs/swagger.
   */
  @Get()
  list(): ProviderMetadata[] {
    return this.registry.list().map((provider) => ({
      id: provider.id,
      category: provider.category,
      defaults: provider.defaults,
    }))
  }
}
