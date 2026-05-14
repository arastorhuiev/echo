import type { ProviderCategory, ProviderDefaults } from "@/core/provider.js"

/**
 * Per-category baseline defaults — providers can override individual
 * fields, but starting from a category-appropriate baseline avoids
 * everyone copy-pasting the same numbers.
 */
const baselineByCategory: Record<ProviderCategory, ProviderDefaults> = {
  username: {
    timeoutMs: 60_000,
    maxConcurrent: 4,
    cacheTtlSec: 24 * 3_600,
    breaker: { failureThreshold: 5, resetMs: 30_000 },
  },
  email: {
    timeoutMs: 30_000,
    maxConcurrent: 4,
    cacheTtlSec: 24 * 3_600,
    breaker: { failureThreshold: 5, resetMs: 30_000 },
  },
  phone: {
    timeoutMs: 30_000,
    maxConcurrent: 4,
    cacheTtlSec: 7 * 24 * 3_600,
    breaker: { failureThreshold: 5, resetMs: 30_000 },
  },
  domain: {
    timeoutMs: 60_000,
    maxConcurrent: 4,
    cacheTtlSec: 24 * 3_600,
    breaker: { failureThreshold: 5, resetMs: 30_000 },
  },
  ip: {
    timeoutMs: 10_000,
    maxConcurrent: 16,
    cacheTtlSec: 7 * 24 * 3_600,
    breaker: { failureThreshold: 5, resetMs: 30_000 },
  },
  breach: {
    timeoutMs: 30_000,
    maxConcurrent: 2,
    cacheTtlSec: 6 * 3_600,
    breaker: { failureThreshold: 3, resetMs: 60_000 },
  },
  image: {
    timeoutMs: 5_000,
    maxConcurrent: 8,
    cacheTtlSec: 0,
    breaker: { failureThreshold: 5, resetMs: 30_000 },
  },
  social: {
    timeoutMs: 60_000,
    maxConcurrent: 2,
    cacheTtlSec: 6 * 3_600,
    breaker: { failureThreshold: 3, resetMs: 5 * 60_000 },
  },
  crypto: {
    timeoutMs: 15_000,
    maxConcurrent: 8,
    cacheTtlSec: 60,
    breaker: { failureThreshold: 5, resetMs: 30_000 },
  },
  tech: {
    timeoutMs: 30_000,
    maxConcurrent: 4,
    cacheTtlSec: 24 * 3_600,
    breaker: { failureThreshold: 5, resetMs: 30_000 },
  },
  people: {
    timeoutMs: 30_000,
    maxConcurrent: 2,
    cacheTtlSec: 6 * 3_600,
    breaker: { failureThreshold: 3, resetMs: 60_000 },
  },
  meta: {
    timeoutMs: 5_000,
    maxConcurrent: 4,
    cacheTtlSec: 60,
    breaker: { failureThreshold: 5, resetMs: 30_000 },
  },
}

export function defaultsFor(
  category: ProviderCategory,
  overrides: Partial<ProviderDefaults> = {},
): ProviderDefaults {
  return { ...baselineByCategory[category], ...overrides }
}
