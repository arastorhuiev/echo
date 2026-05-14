import { Inject, Injectable } from "@nestjs/common"
import type { OsintProvider } from "@/core/provider.js"

/** DI token for the array of providers handed to the registry at construction. */
export const OSINT_PROVIDERS_TOKEN = Symbol.for("@echo/providers/OSINT_PROVIDERS")

/**
 * In-memory map of providerId -> OsintProvider. Constructed once at
 * AppModule boot from the array bound to `OSINT_PROVIDERS_TOKEN`.
 *
 * Read-only at runtime — provider sets change only on application restart.
 */
@Injectable()
export class OsintProviderRegistry {
  private readonly byId = new Map<string, OsintProvider>()

  constructor(@Inject(OSINT_PROVIDERS_TOKEN) providers: readonly OsintProvider[]) {
    for (const provider of providers) {
      if (this.byId.has(provider.id)) {
        throw new Error(`Duplicate OsintProvider id: ${provider.id}`)
      }
      this.byId.set(provider.id, provider)
    }
  }

  /** Look up by id; returns undefined for unknown ids. */
  get(id: string): OsintProvider | undefined {
    return this.byId.get(id)
  }

  /** Look up by id or throw — convenience for code paths that have already validated. */
  getOrThrow(id: string): OsintProvider {
    const provider = this.byId.get(id)
    if (!provider) {
      throw new Error(`Unknown OsintProvider id: ${id}`)
    }
    return provider
  }

  /** All providers in registration order. */
  list(): readonly OsintProvider[] {
    return Array.from(this.byId.values())
  }

  /** Just the ids — useful for `/api/providers` endpoints and validators. */
  ids(): readonly string[] {
    return Array.from(this.byId.keys())
  }
}
