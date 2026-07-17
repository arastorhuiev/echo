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
        // NOTE: `ignorant` is intentionally NOT fanned out. It requires a
        // SPLIT `{ country_code, phone }` (both bare digits), and reliably
        // deriving the country code from a raw identifier needs full E.164
        // parsing (a phone library) — a naive split is ambiguous. It stays
        // available via a direct POST /api/lookups with the structured input.
        // (Follow-up: parse with libphonenumber to add it to the fan-out.)
      ]
    case "image":
      return [{ providerId: "exiftool", query: { image_url: identifier } }]
    case "domain":
      // Intentionally empty — domain/company recon is out of product scope.
      return []
  }
}
