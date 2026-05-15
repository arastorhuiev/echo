import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type SherlockFoundEntry,
  type SherlockInput,
  type SherlockOutput,
  type SidecarEvent,
  sherlockInputSchema,
  sherlockOutputSchema,
  sidecarEventSchema,
} from "@/sherlock/sherlock.types.js"
import { SseFrameParser } from "@/sherlock/sse-parser.js"

/**
 * Subset of `globalThis.fetch` the provider needs. Pulled out so tests can
 * pass a stub without monkey-patching globals. The real call signature on
 * Node 24 returns a `Response` whose `body` is a `ReadableStream<Uint8Array>`.
 */
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

export interface SherlockProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * Sherlock username-hunting provider — proxies to the Python sidecar.
 *
 * Translates the sidecar's discriminated-union events into the canonical
 * `ProviderEvent` shape:
 *
 * | sidecar `kind` | yields                                   |
 * | `started`      | `{ _tag: "Started" }`                    |
 * | `found`        | `{ _tag: "Partial", chunk: { site, url } }` and accumulates |
 * | `not_found`    | (counted toward `checked`; no event)     |
 * | `done`         | `{ _tag: "Final", data: { found, checked } }` |
 * | `error`        | throws `ProviderError`                   |
 *
 * Cancellation: the lookup processor's `AbortController` is wired through
 * to fetch via `signal`, so a `DELETE /api/lookups/:id` tears down the
 * outbound HTTP connection. The sidecar observes the disconnect and
 * terminates its child sherlock subprocess.
 */
export function createSherlockProvider(
  deps: SherlockProviderDeps,
): OsintProvider<SherlockInput, SherlockOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "sherlock",
    category: "username",
    inputSchema: sherlockInputSchema,
    outputSchema: sherlockOutputSchema,
    defaults: defaultsFor("username", {
      timeoutMs: 60_000,
      maxConcurrent: 4,
      cacheTtlSec: 24 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      const url = `${sidecarUrl}/providers/sherlock/run`
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
          "sherlock",
          mapHttpStatusToKind(response.status),
          `sidecar returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }
      if (!response.body) {
        throw new ProviderError("sherlock", "Network", "sidecar response had no body")
      }

      let started = false
      const found: SherlockFoundEntry[] = []
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
              const entry: SherlockFoundEntry = {
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
              // Sidecar's checked count is authoritative — it includes
              // sites where our line parser produced no event (e.g.,
              // malformed output) but the run still processed.
              yield {
                _tag: "Final",
                data: { found, checked: sidecarEvent.checked },
              }
              return
            case "error":
              throw new ProviderError(
                "sherlock",
                "Unknown",
                `sidecar error: ${sidecarEvent.message}`,
              )
          }
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err
        if (ctx.signal.aborted) {
          // Surfaces as Cancelled in the lookup processor via signal.aborted.
          throw err
        }
        throw toProviderError(err, "Network", "sidecar stream ended unexpectedly")
      }

      // Stream closed without a `done` event — be permissive: emit a
      // Final with whatever we accumulated. The alternative is to throw,
      // which would mark the lookup failed even though we may have useful
      // partial results.
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
  return new ProviderError("sherlock", kind, `${prefix}: ${message}`, err)
}

async function* readSidecarEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SidecarEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseFrameParser()
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError")
      const { value, done } = await reader.read()
      if (done) {
        for (const payload of parser.flush()) {
          const parsed = parseSidecarPayload(payload)
          if (parsed) yield parsed
        }
        return
      }
      const chunk = decoder.decode(value, { stream: true })
      for (const payload of parser.push(chunk)) {
        const parsed = parseSidecarPayload(payload)
        if (parsed) yield parsed
      }
    }
  } finally {
    // releaseLock allows the underlying body to be cancelled by fetch's
    // signal teardown; cancel() on the reader stops it explicitly.
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
  }
}

function parseSidecarPayload(payload: string): SidecarEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  const result = sidecarEventSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}
