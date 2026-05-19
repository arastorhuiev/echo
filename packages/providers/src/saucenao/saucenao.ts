import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type SaucenaoInput,
  type SaucenaoMatch,
  type SaucenaoOutput,
  saucenaoInputSchema,
  saucenaoOutputSchema,
} from "@/saucenao/saucenao.types.js"

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

export interface SaucenaoProviderDeps {
  readonly fetch?: FetchLike
  /** Override the API base. Default: saucenao.com. */
  readonly baseUrl?: string
  /** Optional API key. Without one we get the unauth quota (100/day per IP). */
  readonly apiKey?: string
  /** Minimum similarity (0-100) to surface. Default 60. */
  readonly minSimilarity?: number
}

const DEFAULT_BASE_URL = "https://saucenao.com"
const DEFAULT_MIN_SIMILARITY = 60

/**
 * SauceNAO reverse-image lookup.
 *
 * pixel-similarity search (NOT face recognition), so it stays clear of
 * the biometrics regime — fine for "find which Twitter / Pixiv /
 * Mastodon post this avatar came from". Free tier gives 100 unauth
 * requests/day per IP; passing an API key bumps to 200/day.
 *
 * We require an `image_url`; multipart uploads from the worker are
 * intentionally out of scope for the MVP (the API supports them, but
 * the consumer can almost always hand us a URL).
 */
export function createSaucenaoProvider(
  deps: SaucenaoProviderDeps = {},
): OsintProvider<SaucenaoInput, SaucenaoOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  const apiKey = deps.apiKey
  const minSimilarity = deps.minSimilarity ?? DEFAULT_MIN_SIMILARITY

  return {
    id: "saucenao",
    category: "image",
    inputSchema: saucenaoInputSchema,
    outputSchema: saucenaoOutputSchema,
    defaults: defaultsFor("image", {
      timeoutMs: 15_000,
      maxConcurrent: 2,
      cacheTtlSec: 7 * 24 * 3_600,
      breaker: { failureThreshold: 3, resetMs: 60_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const params = new URLSearchParams({
        url: query.image_url,
        output_type: "2", // JSON
        db: "999", // all source DBs
        numres: "8",
      })
      if (apiKey !== undefined && apiKey.length > 0) {
        params.set("api_key", apiKey)
      }

      const url = `${baseUrl}/search.php?${params.toString()}`

      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "echo-osint/1.0 (+contact@arastorhuiev.dev)",
          },
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "saucenao fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "saucenao",
          mapHttpStatusToKind(response.status),
          `saucenao returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }

      let raw: unknown
      try {
        raw = await response.json()
      } catch (err) {
        throw toProviderError(err, "Parse", "saucenao response was not valid JSON")
      }

      const normalised = normalise(raw, minSimilarity)
      const parsed = saucenaoOutputSchema.safeParse(normalised)
      if (!parsed.success) {
        throw new ProviderError(
          "saucenao",
          "Parse",
          `saucenao response failed schema: ${parsed.error.message.slice(0, 200)}`,
        )
      }

      yield { _tag: "Final", data: parsed.data }
    },
  }
}

function normalise(raw: unknown, minSimilarity: number): SaucenaoOutput {
  if (raw === null || typeof raw !== "object") {
    return { matches: [], short_remaining: null, long_remaining: null }
  }
  const r = raw as Record<string, unknown>
  const header = (r.header ?? {}) as Record<string, unknown>
  const results = Array.isArray(r.results) ? r.results : []

  const matches: SaucenaoMatch[] = []
  for (const entry of results) {
    if (entry === null || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const h = (e.header ?? {}) as Record<string, unknown>
    const d = (e.data ?? {}) as Record<string, unknown>

    const sim = parseSimilarity(h.similarity)
    if (sim === null || sim < minSimilarity) continue

    const indexName = typeof h.index_name === "string" ? h.index_name : ""
    const thumbnail = typeof h.thumbnail === "string" ? h.thumbnail : undefined

    const extUrls = Array.isArray(d.ext_urls) ? d.ext_urls : []
    const sourceUrls = extUrls.filter(
      (u): u is string => typeof u === "string" && u.startsWith("http"),
    )

    matches.push({
      similarity: sim,
      index_name: indexName,
      source_urls: sourceUrls,
      ...(thumbnail !== undefined && { thumbnail }),
      ...(typeof d.twitter_user_handle === "string" && {
        twitter_user_handle: d.twitter_user_handle,
      }),
    })
  }

  return {
    matches,
    short_remaining: typeof header.short_remaining === "number" ? header.short_remaining : null,
    long_remaining: typeof header.long_remaining === "number" ? header.long_remaining : null,
  }
}

function parseSimilarity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const n = Number.parseFloat(value)
    if (Number.isFinite(n)) return n
  }
  return null
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
  return new ProviderError("saucenao", kind, `${prefix}: ${message}`, err)
}
