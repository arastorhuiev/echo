import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type TelegramResolveInput,
  type TelegramResolveOutput,
  telegramResolveInputSchema,
  telegramResolveOutputSchema,
} from "@/telegram-resolve/telegram-resolve.types.js"

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

export interface TelegramResolveProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * Telegram phone→profile resolver via the Python sidecar's Telethon
 * integration.
 *
 * Env-conditional: when the sidecar lacks `TELEGRAM_API_ID` /
 * `TELEGRAM_API_HASH` / `TELEGRAM_SESSION_PATH`, the route returns
 * `configured=false` + `error` set; we surface that as a normal `Final`
 * so the rest of the lookup completes. Real Telethon failures land in
 * `error` with `configured=true`.
 */
export function createTelegramResolveProvider(
  deps: TelegramResolveProviderDeps,
): OsintProvider<TelegramResolveInput, TelegramResolveOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "telegram-resolve",
    category: "phone",
    inputSchema: telegramResolveInputSchema,
    outputSchema: telegramResolveOutputSchema,
    defaults: defaultsFor("phone", {
      timeoutMs: 30_000,
      maxConcurrent: 2,
      cacheTtlSec: 6 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 60_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const url = `${sidecarUrl}/providers/telegram-resolve/run`
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
          "telegram-resolve",
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

      const parsed = telegramResolveOutputSchema.safeParse(raw)
      if (!parsed.success) {
        throw new ProviderError(
          "telegram-resolve",
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
  return new ProviderError("telegram-resolve", kind, `${prefix}: ${message}`, err)
}
