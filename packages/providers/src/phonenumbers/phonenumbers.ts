import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type PhonenumbersInput,
  type PhonenumbersOutput,
  phonenumbersInputSchema,
  phonenumbersOutputSchema,
} from "@/phonenumbers/phonenumbers.types.js"

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

export interface PhonenumbersProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * libphonenumber via the Python sidecar.
 *
 * Calls `POST /providers/phonenumbers/run` (sync JSON, not SSE — the
 * upstream library resolves under a millisecond, so streaming buys
 * nothing). We yield `Started` for envelope consistency with the other
 * providers, then `Final` with the validated metadata payload.
 *
 * Note that an "invalid" number is a valid Final, not a throw — the UI
 * surfaces "could not parse this as a phone number" as a real signal.
 */
export function createPhonenumbersProvider(
  deps: PhonenumbersProviderDeps,
): OsintProvider<PhonenumbersInput, PhonenumbersOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "phonenumbers",
    category: "phone",
    inputSchema: phonenumbersInputSchema,
    outputSchema: phonenumbersOutputSchema,
    defaults: defaultsFor("phone", {
      timeoutMs: 5_000,
      maxConcurrent: 16,
      cacheTtlSec: 30 * 24 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const url = `${sidecarUrl}/providers/phonenumbers/run`
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
          "phonenumbers",
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

      const parsed = phonenumbersOutputSchema.safeParse(raw)
      if (!parsed.success) {
        throw new ProviderError(
          "phonenumbers",
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
  return new ProviderError("phonenumbers", kind, `${prefix}: ${message}`, err)
}
