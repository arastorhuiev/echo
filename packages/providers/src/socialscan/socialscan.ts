import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import { SseFrameParser } from "@/sherlock/sse-parser.js"
import {
  type SocialscanInput,
  type SocialscanOutput,
  type SocialscanResultEntry,
  type SocialscanSidecarEvent,
  socialscanInputSchema,
  socialscanOutputSchema,
  socialscanSidecarEventSchema,
} from "@/socialscan/socialscan.types.js"

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
  text: () => Promise<string>
  body: ReadableStream<Uint8Array> | null
}>

export interface SocialscanProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * socialscan provider — availability-check across ~10 social platforms.
 *
 * Semantics differ from Sherlock/Maigret: `available=false` means "this
 * handle is taken on that platform" — a positive signal we surface as
 * existence-elsewhere rather than as a `Partial`'d profile.
 *
 * We still emit each platform-result as a `Partial` to keep the SSE
 * latency story consistent. The Final's `results` array is the same
 * data accumulated for cache.
 */
export function createSocialscanProvider(
  deps: SocialscanProviderDeps,
): OsintProvider<SocialscanInput, SocialscanOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "socialscan",
    category: "username",
    inputSchema: socialscanInputSchema,
    outputSchema: socialscanOutputSchema,
    defaults: defaultsFor("username", {
      timeoutMs: 60_000,
      maxConcurrent: 4,
      cacheTtlSec: 6 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      const url = `${sidecarUrl}/providers/socialscan/run`
      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ queries: query.queries }),
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "sidecar fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "socialscan",
          mapHttpStatusToKind(response.status),
          `sidecar returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }
      if (!response.body) {
        throw new ProviderError("socialscan", "Network", "sidecar response had no body")
      }

      let started = false
      const results: SocialscanResultEntry[] = []
      let checked = 0

      try {
        for await (const sidecarEvent of readSidecarEvents(response.body, ctx.signal)) {
          switch (sidecarEvent.kind) {
            case "started":
              if (!started) {
                started = true
                yield { _tag: "Started" }
              }
              break
            case "result": {
              const entry: SocialscanResultEntry = {
                query: sidecarEvent.query,
                platform: sidecarEvent.platform,
                available: sidecarEvent.available ?? null,
                valid: sidecarEvent.valid ?? null,
                success: sidecarEvent.success ?? null,
                ...(sidecarEvent.message !== undefined && { message: sidecarEvent.message }),
              }
              results.push(entry)
              checked += 1
              yield { _tag: "Partial", chunk: entry }
              break
            }
            case "done":
              yield {
                _tag: "Final",
                data: { results, checked: sidecarEvent.checked },
              }
              return
            case "error":
              throw new ProviderError(
                "socialscan",
                "Unknown",
                `sidecar error: ${sidecarEvent.message}`,
              )
          }
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err
        if (ctx.signal.aborted) throw err
        throw toProviderError(err, "Network", "sidecar stream ended unexpectedly")
      }

      yield { _tag: "Final", data: { results, checked } }
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
  return new ProviderError("socialscan", kind, `${prefix}: ${message}`, err)
}

async function* readSidecarEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SocialscanSidecarEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseFrameParser()
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError")
      const { value, done } = await reader.read()
      if (done) {
        for (const payload of parser.flush()) {
          const parsed = parsePayload(payload)
          if (parsed) yield parsed
        }
        return
      }
      const chunk = decoder.decode(value, { stream: true })
      for (const payload of parser.push(chunk)) {
        const parsed = parsePayload(payload)
        if (parsed) yield parsed
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
  }
}

function parsePayload(payload: string): SocialscanSidecarEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  const result = socialscanSidecarEventSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}
