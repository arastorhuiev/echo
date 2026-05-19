import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type PhoneinfogaInput,
  type PhoneinfogaOutput,
  phoneinfogaInputSchema,
  phoneinfogaOutputSchema,
} from "@/phoneinfoga/phoneinfoga.types.js"

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

export interface PhoneinfogaProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * PhoneInfoga provider — proxies to the Python sidecar which spawns
 * the Go CLI binary per request. Returns local-scanner metadata
 * (country/carrier/line type) plus a list of ready-to-click Google
 * dork URLs the UI surfaces as "search for this number on Facebook /
 * LinkedIn / pastebins".
 *
 * Sync JSON shape (not SSE) — the upstream scan completes in 1-3s, no
 * streaming benefit. Subprocess errors land in `error` and surface as
 * a Final, not a thrown ProviderError.
 */
export function createPhoneinfogaProvider(
  deps: PhoneinfogaProviderDeps,
): OsintProvider<PhoneinfogaInput, PhoneinfogaOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "phoneinfoga",
    category: "phone",
    inputSchema: phoneinfogaInputSchema,
    outputSchema: phoneinfogaOutputSchema,
    defaults: defaultsFor("phone", {
      timeoutMs: 30_000,
      maxConcurrent: 4,
      cacheTtlSec: 7 * 24 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const url = `${sidecarUrl}/providers/phoneinfoga/run`
      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ phone: query.phone }),
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "sidecar fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "phoneinfoga",
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

      const parsed = phoneinfogaOutputSchema.safeParse(raw)
      if (!parsed.success) {
        throw new ProviderError(
          "phoneinfoga",
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
  return new ProviderError("phoneinfoga", kind, `${prefix}: ${message}`, err)
}
