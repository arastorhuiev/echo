import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type IgnorantInput,
  type IgnorantOutput,
  type IgnorantResultEntry,
  type IgnorantSidecarEvent,
  ignorantInputSchema,
  ignorantOutputSchema,
  ignorantSidecarEventSchema,
} from "@/ignorant/ignorant.types.js"
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

export interface IgnorantProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * ignorant phone→social-presence provider.
 *
 * Each upstream platform check (Instagram / Snapchat / Amazon) becomes a
 * `Partial` event; the Final's `results` array re-accumulates them for
 * cache. `exists=true` ⇒ the phone is registered on that platform — the
 * real signal. `rate_limit=true` means upstream throttled us and the
 * answer is unreliable for that platform.
 */
export function createIgnorantProvider(
  deps: IgnorantProviderDeps,
): OsintProvider<IgnorantInput, IgnorantOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "ignorant",
    category: "phone",
    inputSchema: ignorantInputSchema,
    outputSchema: ignorantOutputSchema,
    defaults: defaultsFor("phone", {
      timeoutMs: 30_000,
      maxConcurrent: 2,
      cacheTtlSec: 6 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      const url = `${sidecarUrl}/providers/ignorant/run`
      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            country_code: query.country_code,
            phone: query.phone,
          }),
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "sidecar fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "ignorant",
          mapHttpStatusToKind(response.status),
          `sidecar returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }
      if (!response.body) {
        throw new ProviderError("ignorant", "Network", "sidecar response had no body")
      }

      let started = false
      const results: IgnorantResultEntry[] = []
      let checked = 0

      try {
        for await (const event of readSidecarEvents(response.body, ctx.signal)) {
          switch (event.kind) {
            case "started":
              if (!started) {
                started = true
                yield { _tag: "Started" }
              }
              break
            case "result": {
              const entry: IgnorantResultEntry = {
                platform: event.platform,
                domain: event.domain ?? null,
                method: event.method ?? null,
                exists: event.exists ?? null,
                rate_limit: event.rate_limit ?? null,
                frequent_rate_limit: event.frequent_rate_limit ?? null,
              }
              results.push(entry)
              checked += 1
              yield { _tag: "Partial", chunk: entry }
              break
            }
            case "done":
              yield {
                _tag: "Final",
                data: { results, checked: event.checked },
              }
              return
            case "error":
              throw new ProviderError("ignorant", "Unknown", `sidecar error: ${event.message}`)
          }
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err
        if (ctx.signal.aborted) throw err
        throw toProviderError(err, "Network", "sidecar stream ended unexpectedly")
      }

      // Stream closed without `done` — emit a Final with what we have.
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
  return new ProviderError("ignorant", kind, `${prefix}: ${message}`, err)
}

async function* readSidecarEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<IgnorantSidecarEvent> {
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

function parsePayload(payload: string): IgnorantSidecarEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  const result = ignorantSidecarEventSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}
