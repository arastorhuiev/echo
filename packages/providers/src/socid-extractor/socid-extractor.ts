import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type SocidExtractorInput,
  type SocidExtractorOutput,
  socidExtractorInputSchema,
  socidExtractorOutputSchema,
} from "@/socid-extractor/socid-extractor.types.js"

export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  },
) => Promise<{
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface SocidExtractorProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * URL → site-specific IDs via the Python sidecar's socid_extractor
 * integration. Designed to run as a post-processor: feed it URLs that
 * Sherlock / Maigret / WhatsMyName found and pull out the
 * platform-native IDs (Telegram user_id, VK profile id, GitHub commit
 * emails, Patreon ids, ~130 site-specific extractors in total).
 *
 * Synchronous JSON shape (not SSE) — one URL in, one Final out. Network
 * + parser failures land in `error` rather than throwing, so the rest
 * of the lookup pipeline keeps going.
 */
export function createSocidExtractorProvider(
  deps: SocidExtractorProviderDeps,
): OsintProvider<SocidExtractorInput, SocidExtractorOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "socid-extractor",
    category: "username",
    inputSchema: socidExtractorInputSchema,
    outputSchema: socidExtractorOutputSchema,
    defaults: defaultsFor("username", {
      timeoutMs: 20_000,
      maxConcurrent: 4,
      cacheTtlSec: 12 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const url = `${sidecarUrl}/providers/socid-extractor/run`
      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ url: query.url }),
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "sidecar fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "socid-extractor",
          mapHttpStatusToKind(response.status),
          `sidecar returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }

      let raw: unknown
      try {
        raw = await response.json()
      } catch (err) {
        throw toProviderError(err, "Parse", "sidecar response was not valid JSON")
      }

      const parsed = socidExtractorOutputSchema.safeParse(raw)
      if (!parsed.success) {
        throw new ProviderError(
          "socid-extractor",
          "Parse",
          `sidecar response failed schema: ${parsed.error.message.slice(0, 200)}`,
        )
      }

      yield { _tag: "Final", data: parsed.data }
    },
  }
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "")
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
  return new ProviderError("socid-extractor", kind, `${prefix}: ${message}`, err)
}
