import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type TruecallerInput,
  type TruecallerOutput,
  truecallerInputSchema,
  truecallerOutputSchema,
} from "@/truecaller/truecaller.types.js"

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

export interface TruecallerProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * Truecaller phone→identity lookup via the truecallerpy unofficial
 * wrapper, hosted in the Python sidecar.
 *
 * Env-conditional. Returns `configured=false` when the sidecar can't
 * find `TRUECALLER_INSTALLATION_ID`; Truecaller-side failures
 * (FLOOD_WAIT, schema-rotation, ban) land in `error` with
 * `configured=true`. The provider never throws on those — the rest of
 * the phone-lookup pipeline keeps running.
 */
export function createTruecallerProvider(
  deps: TruecallerProviderDeps,
): OsintProvider<TruecallerInput, TruecallerOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "truecaller",
    category: "phone",
    inputSchema: truecallerInputSchema,
    outputSchema: truecallerOutputSchema,
    defaults: defaultsFor("phone", {
      timeoutMs: 25_000,
      maxConcurrent: 2,
      cacheTtlSec: 6 * 3_600,
      breaker: { failureThreshold: 3, resetMs: 5 * 60_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const url = `${sidecarUrl}/providers/truecaller/run`
      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            phone: query.phone,
            country_code: query.country_code ?? null,
          }),
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "sidecar fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "truecaller",
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

      const parsed = truecallerOutputSchema.safeParse(raw)
      if (!parsed.success) {
        throw new ProviderError(
          "truecaller",
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
  return new ProviderError("truecaller", kind, `${prefix}: ${message}`, err)
}
