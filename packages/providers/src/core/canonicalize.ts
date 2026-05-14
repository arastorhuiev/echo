import { createHash } from "node:crypto"

/**
 * Stable JSON serialisation: object keys sorted recursively so two
 * payloads with the same data produce the same string regardless of
 * property order. Used as the cache-key input.
 *
 * Arrays are NOT reordered (ordering is meaningful for them).
 */
export function canonicalizeQuery(query: unknown): string {
  return JSON.stringify(query, sortKeys)
}

function sortKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value
  }
  const obj = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = obj[k]
  }
  return sorted
}

/**
 * SHA-256 of the canonical JSON. The cache key for any provider is
 * `cache:result:<providerId>:<queryHash>`; idempotency on
 * `lookups (provider_id, query_hash)` uses the same hash.
 */
export function queryHash(query: unknown): string {
  return createHash("sha256").update(canonicalizeQuery(query)).digest("hex")
}
