import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type ExiftoolInput,
  type ExiftoolOutput,
  exiftoolInputSchema,
  exiftoolOutputSchema,
} from "@/exiftool/exiftool.types.js"

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

export interface ExiftoolProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * ExifTool provider — image URL → EXIF / IPTC / XMP metadata via the
 * Python sidecar. GPL-3.0 upstream, kept at arm's length by the
 * subprocess boundary (sidecar shells out to the `exiftool` Perl
 * binary, never imports it).
 *
 * Slim output — only fields the UI actually surfaces: camera make /
 * model / lens / software, GPS lat/lon/alt, IPTC byline + credit,
 * XMP creator + rights. Anything else from ExifTool's ~200-field
 * default dump gets dropped at the sidecar normalisation step.
 *
 * Download + parse errors land in `error`, not as throws.
 */
export function createExiftoolProvider(
  deps: ExiftoolProviderDeps,
): OsintProvider<ExiftoolInput, ExiftoolOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "exiftool",
    category: "image",
    inputSchema: exiftoolInputSchema,
    outputSchema: exiftoolOutputSchema,
    defaults: defaultsFor("image", {
      timeoutMs: 30_000,
      maxConcurrent: 4,
      // Per-upload metadata is not really worth caching — but a short
      // TTL lets us coalesce duplicate requests during a single lookup.
      cacheTtlSec: 300,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const url = `${sidecarUrl}/providers/exiftool/run`
      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ image_url: query.image_url }),
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "sidecar fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "exiftool",
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

      const parsed = exiftoolOutputSchema.safeParse(raw)
      if (!parsed.success) {
        throw new ProviderError(
          "exiftool",
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
  return new ProviderError("exiftool", kind, `${prefix}: ${message}`, err)
}
