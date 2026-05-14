import type { ZodType } from "zod"

/**
 * Categories the registry uses for grouping. Drives metric labels and
 * (later) UI grouping. New categories require a coordinated change in
 * `@echo/db/schema/providers.ts` and the docs/PROVIDERS.md catalog.
 */
export type ProviderCategory =
  | "username"
  | "email"
  | "phone"
  | "domain"
  | "ip"
  | "breach"
  | "image"
  | "social"
  | "crypto"
  | "tech"
  | "people"
  | "meta"

/**
 * Per-provider runtime defaults applied by wrappers. A real provider
 * declares these once; the wrappers consume them to size caches,
 * concurrency caps, and breaker windows.
 */
export interface ProviderDefaults {
  /** Hard timeout for a single `run()` invocation. */
  readonly timeoutMs: number
  /** Worker-side concurrency cap (BullMQ queue concurrency). */
  readonly maxConcurrent: number
  /** Successful-result cache TTL in seconds. 0 disables caching. */
  readonly cacheTtlSec: number
  /** Circuit-breaker policy (see `withBreaker`). */
  readonly breaker: {
    readonly failureThreshold: number
    readonly resetMs: number
  }
}

/**
 * What a provider yields during a run. Each event is persisted to
 * `lookup_events` (one row per yield) and forwarded to SSE consumers.
 *
 * Providers do NOT yield `Failed` — they `throw new ProviderError(...)`.
 * The lookup processor turns the throw into a persisted Failed event.
 */
export type ProviderEvent<R = unknown> =
  | { readonly _tag: "Started" }
  | { readonly _tag: "Progress"; readonly pct: number; readonly note?: string }
  | { readonly _tag: "Partial"; readonly chunk: unknown }
  | { readonly _tag: "Final"; readonly data: R }
  | { readonly _tag: "Cancelled" }

/**
 * Per-run context handed to every `run()` invocation. The signal is
 * fired when the lookup is cancelled (via `DELETE /api/lookups/:id` in
 * P6) — providers SHOULD propagate it into their outbound HTTP calls.
 */
export interface ProviderRunContext {
  readonly lookupId: string
  readonly signal: AbortSignal
}

/**
 * The single load-bearing interface in the codebase. Each OSINT
 * integration implements this. Wrappers in `core/wrappers/*` add
 * caching, single-flight, breaker, rate-limiting, and tracing
 * uniformly so individual providers stay focused on their actual job.
 */
export interface OsintProvider<Q = unknown, R = unknown> {
  /** Stable identifier — also the BullMQ queue suffix and DB foreign key. */
  readonly id: string
  /** Drives metric labels + future UI grouping. */
  readonly category: ProviderCategory
  /** Validates incoming `query` payloads at the API edge. */
  readonly inputSchema: ZodType<Q>
  /** Validates the `Final` event's `data` field. */
  readonly outputSchema: ZodType<R>
  readonly defaults: ProviderDefaults
  /** Streams events for one run. Throws `ProviderError` on failure. */
  run(query: Q, ctx: ProviderRunContext): AsyncIterable<ProviderEvent<R>>
}

/**
 * Categorisation of upstream failures so wrappers (breaker, rate-limit)
 * can react differently. e.g., `RateLimited` may extend the breaker
 * window; `Banned` should open the breaker outright.
 */
export type ProviderErrorKind =
  | "Timeout"
  | "RateLimited"
  | "Unauthorized"
  | "Banned"
  | "Network"
  | "Parse"
  | "Unknown"

/**
 * Tagged error every provider throws on failure. The lookup processor
 * inspects `kind` when deciding what to persist and whether to retry.
 */
export class ProviderError extends Error {
  override readonly name = "ProviderError"

  constructor(
    readonly providerId: string,
    readonly kind: ProviderErrorKind,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined)
  }
}
