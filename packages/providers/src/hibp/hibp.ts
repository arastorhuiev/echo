import { createHash } from "node:crypto"
import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type HibpInput,
  type HibpOutput,
  hibpInputSchema,
  hibpOutputSchema,
} from "@/hibp/hibp.types.js"

export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    signal?: AbortSignal
  },
) => Promise<{
  ok: boolean
  status: number
  statusText: string
  text: () => Promise<string>
}>

export interface HibpProviderDeps {
  readonly fetch?: FetchLike
  /** Override the API base; tests use this. Defaults to api.pwnedpasswords.com. */
  readonly baseUrl?: string
}

const DEFAULT_BASE_URL = "https://api.pwnedpasswords.com"

/**
 * HIBP Pwned Passwords lookup via the k-anonymity range API.
 *
 * The user-supplied password is hashed with SHA-1 in-process. Only the
 * first 5 hex chars of the hash leave the process — HIBP returns every
 * hash that begins with that prefix paired with its breach count. We
 * search the returned list for the remaining 35 chars locally; the
 * password itself never crosses a network boundary.
 *
 * SHA-1 here is part of the protocol, not a security choice. HIBP picked
 * it for the v2 range API and migrating is their call.
 */
export function createHibpProvider(
  deps: HibpProviderDeps = {},
): OsintProvider<HibpInput, HibpOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")

  return {
    id: "hibp-pwned-passwords",
    category: "breach",
    inputSchema: hibpInputSchema,
    outputSchema: hibpOutputSchema,
    defaults: defaultsFor("breach", {
      timeoutMs: 10_000,
      maxConcurrent: 8,
      // Caching the breach count by password hash leaks nothing extra
      // (the hash is per-user) but TTL stays short since HIBP corpus
      // grows continuously.
      cacheTtlSec: 6 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const sha1Upper = sha1Hex(query.password).toUpperCase()
      const prefix = sha1Upper.slice(0, 5)
      const suffix = sha1Upper.slice(5)
      const url = `${baseUrl}/range/${prefix}`

      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "text/plain",
            // HIBP recommends a UA — generic one is fine, only request volume matters.
            "User-Agent": "echo-osint/1.0 (+contact@arastorhuiev.dev)",
          },
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "hibp fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "hibp-pwned-passwords",
          mapHttpStatusToKind(response.status),
          `hibp returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }

      let body: string
      try {
        body = await response.text()
      } catch (err) {
        throw toProviderError(err, "Network", "hibp response body read failed")
      }

      const count = findCountForSuffix(body, suffix)
      yield { _tag: "Final", data: { pwned: count > 0, breach_count: count } }
    },
  }
}

function sha1Hex(input: string): string {
  return createHash("sha1").update(input).digest("hex")
}

/**
 * HIBP returns one `<SUFFIX>:<COUNT>` per line. Lines beyond the first
 * 35-char suffix and beyond the colon-then-digits format are ignored.
 * Returns 0 when no line matches our suffix.
 */
function findCountForSuffix(body: string, suffix: string): number {
  // Split on either \r\n or \n; HIBP uses CRLF but be liberal.
  const lines = body.split(/\r?\n/)
  for (const raw of lines) {
    if (raw.length < 36) continue
    const lineSuffix = raw.slice(0, 35)
    if (raw[35] !== ":") continue
    if (lineSuffix !== suffix) continue
    const countPart = raw.slice(36).trim()
    const n = Number.parseInt(countPart, 10)
    if (Number.isFinite(n) && n >= 0) return n
    return 0
  }
  return 0
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
  return new ProviderError("hibp-pwned-passwords", kind, `${prefix}: ${message}`, err)
}
