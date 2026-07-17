import type { SearchKind } from "@echo/db/schema"

export interface SearchTarget {
  readonly providerId: string
  /** Provider-specific query, still validated against the provider's inputSchema before enqueue. */
  readonly query: unknown
}

/**
 * Which providers a classified identifier fans out to, and how to shape each
 * provider's query (P12). Only reliable, always-configured providers are
 * listed — the credentialed/fragile set (ghunt, truecaller, telegram-resolve,
 * mailcat) is excluded so a fan-out never depends on env-conditional creds.
 * The caller further filters to providers actually present + enabled in the
 * registry, so an unknown/removed id here is harmless.
 */
export function applicableTargets(kind: SearchKind, identifier: string): SearchTarget[] {
  switch (kind) {
    case "username":
      return [
        { providerId: "sherlock", query: { username: identifier } },
        { providerId: "maigret", query: { username: identifier } },
        { providerId: "whatsmyname", query: { username: identifier } },
        { providerId: "socialscan", query: { queries: [identifier] } },
        { providerId: "hudsonrock", query: { username: identifier } },
      ]
    case "email":
      return [
        { providerId: "hudsonrock", query: { email: identifier } },
        { providerId: "socialscan", query: { queries: [identifier] } },
      ]
    case "phone":
      return [
        { providerId: "phonenumbers", query: { phone: identifier } },
        { providerId: "phoneinfoga", query: { phone: identifier } },
        // ignorant only accepts bare digits (its inputSchema is /^\d+$/).
        { providerId: "ignorant", query: { phone: identifier.replace(/\D/g, "") } },
      ]
    case "image":
      return [{ providerId: "exiftool", query: { image_url: identifier } }]
    case "domain":
      // Intentionally empty — domain/company recon is out of product scope.
      return []
  }
}
