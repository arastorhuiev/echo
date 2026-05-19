import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type MailcatFoundEntry,
  type MailcatInput,
  type MailcatOutput,
  type MailcatSidecarEvent,
  mailcatInputSchema,
  mailcatOutputSchema,
  mailcatSidecarEventSchema,
} from "@/mailcat/mailcat.types.js"
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

export interface MailcatProviderDeps {
  readonly sidecarUrl: string
  readonly fetch?: FetchLike
}

/**
 * mailcat provider — username → existing email addresses across ~22
 * common providers. Env-conditional on the sidecar side
 * (`MAILCAT_INSTALL_PATH` must point at a cloned + provisioned mailcat
 * repo; we deliberately don't bake Chromium into the default image).
 *
 * Sidecar emits per-provider events; `exists=true` ⇒ that provider
 * shows the candidate email as registered. The Final's `found` is the
 * convenience slice of `results` where `exists=true`. Sidecar-side
 * "not configured" lands in the Final's `error` field, not as a throw.
 */
export function createMailcatProvider(
  deps: MailcatProviderDeps,
): OsintProvider<MailcatInput, MailcatOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const sidecarUrl = trimTrailingSlashes(deps.sidecarUrl)

  return {
    id: "mailcat",
    category: "username",
    inputSchema: mailcatInputSchema,
    outputSchema: mailcatOutputSchema,
    defaults: defaultsFor("username", {
      timeoutMs: 90_000,
      maxConcurrent: 2,
      cacheTtlSec: 12 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 60_000 },
    }),

    async *run(query, ctx) {
      const url = `${sidecarUrl}/providers/mailcat/run`
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
          "mailcat",
          mapHttpStatusToKind(response.status),
          `sidecar returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }
      if (!response.body) {
        throw new ProviderError("mailcat", "Network", "sidecar response had no body")
      }

      let started = false
      const results: MailcatFoundEntry[] = []
      let checked = 0
      let configError: string | null = null

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
              const entry: MailcatFoundEntry = {
                email: event.email,
                exists: event.exists,
              }
              results.push(entry)
              checked += 1
              if (event.exists) {
                yield { _tag: "Partial", chunk: entry }
              }
              break
            }
            case "done":
              if (!started) yield { _tag: "Started" }
              yield {
                _tag: "Final",
                data: {
                  results,
                  found: results.filter((r) => r.exists).map((r) => r.email),
                  checked: event.checked,
                  error: configError,
                },
              }
              return
            case "error":
              // For mailcat we treat error-events as a "not configured" /
              // "subprocess failed" signal — capture and surface in the
              // Final rather than throw. The runner emits at most one
              // error event before tearing down.
              if (!started) yield { _tag: "Started" }
              configError = event.message
              yield {
                _tag: "Final",
                data: {
                  results,
                  found: results.filter((r) => r.exists).map((r) => r.email),
                  checked,
                  error: configError,
                },
              }
              return
          }
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err
        if (ctx.signal.aborted) throw err
        throw toProviderError(err, "Network", "sidecar stream ended unexpectedly")
      }

      // Stream closed without `done` or `error` — emit a Final with what we have.
      if (!started) yield { _tag: "Started" }
      yield {
        _tag: "Final",
        data: {
          results,
          found: results.filter((r) => r.exists).map((r) => r.email),
          checked,
          error: configError,
        },
      }
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
  return new ProviderError("mailcat", kind, `${prefix}: ${message}`, err)
}

async function* readSidecarEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<MailcatSidecarEvent> {
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

function parsePayload(payload: string): MailcatSidecarEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  const result = mailcatSidecarEventSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}
