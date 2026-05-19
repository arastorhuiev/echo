import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type MaigretFoundEntry,
  type MaigretInput,
  type MaigretOutput,
  type MaigretSidecarEvent,
  maigretInputSchema,
  maigretOutputSchema,
  maigretSidecarEventSchema,
} from "@/maigret/maigret.types.js"
import { SseFrameParser } from "@/sherlock/sse-parser.js"

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

export interface MaigretProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * Maigret username-hunting provider — proxies to the Python sidecar.
 *
 * Same SSE-event vocabulary as Sherlock; Maigret has ~3x the site
 * corpus and tends to find a superset of Sherlock results. Run side by
 * side and deduplicate at the orchestration layer.
 */
export function createMaigretProvider(
  deps: MaigretProviderDeps,
): OsintProvider<MaigretInput, MaigretOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "maigret",
    category: "username",
    inputSchema: maigretInputSchema,
    outputSchema: maigretOutputSchema,
    defaults: defaultsFor("username", {
      timeoutMs: 180_000,
      maxConcurrent: 2,
      cacheTtlSec: 24 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      const url = `${sidecarUrl}/providers/maigret/run`
      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ username: query.username }),
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "sidecar fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "maigret",
          mapHttpStatusToKind(response.status),
          `sidecar returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }
      if (!response.body) {
        throw new ProviderError("maigret", "Network", "sidecar response had no body")
      }

      let started = false
      const found: MaigretFoundEntry[] = []
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
            case "found": {
              const entry: MaigretFoundEntry = {
                site: sidecarEvent.site,
                url: sidecarEvent.url,
              }
              found.push(entry)
              checked += 1
              yield { _tag: "Partial", chunk: entry }
              break
            }
            case "not_found":
              checked += 1
              break
            case "done":
              yield {
                _tag: "Final",
                data: { found, checked: sidecarEvent.checked },
              }
              return
            case "error":
              throw new ProviderError(
                "maigret",
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

      // Stream closed without `done` — be permissive: emit a Final with
      // whatever we accumulated, same as the Sherlock wrapper.
      yield { _tag: "Final", data: { found, checked } }
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
  return new ProviderError("maigret", kind, `${prefix}: ${message}`, err)
}

async function* readSidecarEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<MaigretSidecarEvent> {
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

function parsePayload(payload: string): MaigretSidecarEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  const result = maigretSidecarEventSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}
