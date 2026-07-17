import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type HudsonRockInput,
  type HudsonRockOutput,
  hudsonRockInputSchema,
  hudsonRockOutputSchema,
} from "@/hudsonrock/hudsonrock.types.js"

export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    signal?: AbortSignal
  },
) => Promise<{
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface HudsonRockProviderDeps {
  readonly fetch?: FetchLike
  /** Override the API base; tests use this. */
  readonly baseUrl?: string
}

const DEFAULT_BASE_URL = "https://cavalier.hudsonrock.com/api/json/v2/osint-tools"

/**
 * Hudson Rock Cavalier — keyless infostealer-breach intel. Given an email
 * or username, returns whether the identifier shows up in known
 * info-stealer logs and the associated stealer records. Complements the
 * HIBP password hashcheck (which only covers password corpora) with
 * account-compromise signal. Free, no API key, so it's a core-safe
 * provider (unlike the credentialed fragile set).
 */
export function createHudsonRockProvider(
  deps: HudsonRockProviderDeps = {},
): OsintProvider<HudsonRockInput, HudsonRockOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")

  return {
    id: "hudsonrock",
    category: "breach",
    inputSchema: hudsonRockInputSchema,
    outputSchema: hudsonRockOutputSchema,
    defaults: defaultsFor("breach", {
      timeoutMs: 15_000,
      maxConcurrent: 4,
      cacheTtlSec: 6 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const url = endpointFor(baseUrl, query)

      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json", "User-Agent": "echo-osint/1.0" },
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "hudsonrock fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "hudsonrock",
          mapHttpStatusToKind(response.status),
          `hudsonrock returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }

      let body: unknown
      try {
        body = await response.json()
      } catch (err) {
        throw toProviderError(err, "Parse", "hudsonrock response parse failed")
      }

      yield { _tag: "Final", data: summarise(body) }
    },
  }
}

function endpointFor(baseUrl: string, query: HudsonRockInput): string {
  if ("email" in query) {
    return `${baseUrl}/search-by-email?email=${encodeURIComponent(query.email)}`
  }
  return `${baseUrl}/search-by-username?username=${encodeURIComponent(query.username)}`
}

/**
 * Cavalier returns `{ message, stealers: [...], ... }`. `stealers` is
 * present-and-non-empty exactly when the identifier is compromised. We read
 * defensively (the top-level shape carries many optional aggregate fields
 * that vary by endpoint) and derive `found` from the stealer records.
 *
 * DOCKER-LANE TODO: only the `search-by-email` shape is confirmed. If the
 * `search-by-username` "found" response nests records under a different key,
 * this returns a false `found:false` — capture one real positive hit per
 * endpoint and branch here if the shapes diverge (see docs/ROADMAP.md P8f-2).
 */
function summarise(body: unknown): HudsonRockOutput {
  const obj = (body ?? {}) as Record<string, unknown>
  const stealers = Array.isArray(obj.stealers) ? obj.stealers : []
  const message = typeof obj.message === "string" ? obj.message : ""
  return {
    found: stealers.length > 0,
    message,
    stealerCount: stealers.length,
    stealers,
  }
}

function mapHttpStatusToKind(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "Unauthorized"
  if (status === 408 || status === 504) return "Timeout"
  if (status === 429) return "RateLimited"
  if (status >= 500) return "Network"
  return "Unknown"
}

function toProviderError(err: unknown, fallback: ProviderErrorKind, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err
  const message = err instanceof Error ? err.message : String(err)
  const kind: ProviderErrorKind =
    err instanceof DOMException && err.name === "TimeoutError" ? "Timeout" : fallback
  return new ProviderError("hudsonrock", kind, `${prefix}: ${message}`, err)
}
