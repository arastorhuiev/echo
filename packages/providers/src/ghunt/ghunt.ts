import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type GhuntInput,
  type GhuntOutput,
  ghuntInputSchema,
  ghuntOutputSchema,
} from "@/ghunt/ghunt.types.js"

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

export interface GhuntProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * GHunt provider — email → Google profile / Maps reviews via the Python
 * sidecar.
 *
 * AGPL-3.0 upstream, kept at arm's length by the sidecar — we never
 * import GHunt into TS or our app's Python code. Subprocess invocation
 * counts as "mere aggregation"; AGPL §13 only triggers if we modify the
 * upstream code, which we don't.
 *
 * Env-conditional. The sidecar returns `configured=false` until
 * `GHUNT_CREDS_PATH` is set + the file exists (the one-time
 * `ghunt login` ritual, see RUNBOOK). Both "not configured" and real
 * GHunt failures land in `error` with the appropriate `configured` flag
 * — we never throw, the rest of the lookup pipeline keeps running.
 */
export function createGhuntProvider(
  deps: GhuntProviderDeps,
): OsintProvider<GhuntInput, GhuntOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "ghunt",
    category: "email",
    inputSchema: ghuntInputSchema,
    outputSchema: ghuntOutputSchema,
    defaults: defaultsFor("email", {
      timeoutMs: 60_000,
      maxConcurrent: 2,
      cacheTtlSec: 12 * 3_600,
      breaker: { failureThreshold: 3, resetMs: 5 * 60_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const url = `${sidecarUrl}/providers/ghunt/run`
      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: query.email }),
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "sidecar fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "ghunt",
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

      const parsed = ghuntOutputSchema.safeParse(raw)
      if (!parsed.success) {
        throw new ProviderError(
          "ghunt",
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
  return new ProviderError("ghunt", kind, `${prefix}: ${message}`, err)
}
