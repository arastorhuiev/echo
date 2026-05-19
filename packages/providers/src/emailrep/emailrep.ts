import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type EmailrepDetails,
  type EmailrepInput,
  type EmailrepOutput,
  emailrepInputSchema,
  emailrepOutputSchema,
} from "@/emailrep/emailrep.types.js"

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
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface EmailrepProviderDeps {
  readonly fetch?: FetchLike
  /** Override the API base; tests use this. Defaults to emailrep.io. */
  readonly baseUrl?: string
  /** Optional API key — bumps the rate quota above the unauth free tier. */
  readonly apiKey?: string
}

const DEFAULT_BASE_URL = "https://emailrep.io"

/**
 * EmailRep reputation lookup. Free unauthenticated tier is enough for
 * MVP traffic; passing `apiKey` only raises the rate-limit, no extra
 * fields appear. EmailRep always responds 200 with a populated body —
 * `reputation: "none"` is the "we know nothing about this email" answer,
 * not a 404. Treat that as a normal Final, not a failure.
 */
export function createEmailrepProvider(
  deps: EmailrepProviderDeps = {},
): OsintProvider<EmailrepInput, EmailrepOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  const apiKey = deps.apiKey

  return {
    id: "emailrep",
    category: "email",
    inputSchema: emailrepInputSchema,
    outputSchema: emailrepOutputSchema,
    defaults: defaultsFor("email", {
      timeoutMs: 10_000,
      maxConcurrent: 4,
      cacheTtlSec: 12 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const url = `${baseUrl}/${encodeURIComponent(query.email.trim().toLowerCase())}`
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "echo-osint/1.0 (+contact@arastorhuiev.dev)",
      }
      if (apiKey !== undefined && apiKey.length > 0) {
        headers.Key = apiKey
      }

      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, { method: "GET", headers, signal: ctx.signal })
      } catch (err) {
        throw toProviderError(err, "Network", "emailrep fetch failed")
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "emailrep",
          mapHttpStatusToKind(response.status),
          `emailrep returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }

      let raw: unknown
      try {
        raw = await response.json()
      } catch (err) {
        throw toProviderError(err, "Parse", "emailrep response was not valid JSON")
      }

      const slim = pickFields(raw, query.email.trim().toLowerCase())
      const parsed = emailrepOutputSchema.safeParse(slim)
      if (!parsed.success) {
        throw new ProviderError(
          "emailrep",
          "Parse",
          `emailrep response failed schema: ${parsed.error.message.slice(0, 200)}`,
        )
      }

      yield { _tag: "Final", data: parsed.data }
    },
  }
}

function pickFields(raw: unknown, fallbackEmail: string): EmailrepOutput {
  if (raw === null || typeof raw !== "object") {
    return { email: fallbackEmail, reputation: "none", suspicious: false, references: 0 }
  }
  const r = raw as Record<string, unknown>

  const reputation = isReputation(r.reputation) ? r.reputation : "none"
  const out: EmailrepOutput = {
    email: typeof r.email === "string" ? r.email : fallbackEmail,
    reputation,
    suspicious: typeof r.suspicious === "boolean" ? r.suspicious : false,
    references: typeof r.references === "number" && r.references >= 0 ? r.references : 0,
  }

  if (r.details !== null && typeof r.details === "object") {
    out.details = pickDetailsFields(r.details as Record<string, unknown>)
  }
  return out
}

function pickDetailsFields(d: Record<string, unknown>): EmailrepDetails {
  const details: EmailrepDetails = {}
  for (const key of [
    "blacklisted",
    "malicious_activity",
    "deliverable",
    "domain_exists",
    "data_breach",
    "credentials_leaked",
    "spam",
  ] as const) {
    const v = d[key]
    if (typeof v === "boolean") details[key] = v
  }
  if (typeof d.first_seen === "string") details.first_seen = d.first_seen
  if (typeof d.last_seen === "string") details.last_seen = d.last_seen
  if (isReputation(d.domain_reputation)) details.domain_reputation = d.domain_reputation
  if (Array.isArray(d.profiles)) {
    const profiles = d.profiles.filter((p): p is string => typeof p === "string" && p.length > 0)
    if (profiles.length > 0) details.profiles = profiles
  }
  return details
}

function isReputation(v: unknown): v is "none" | "low" | "medium" | "high" {
  return v === "none" || v === "low" || v === "medium" || v === "high"
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
  return new ProviderError("emailrep", kind, `${prefix}: ${message}`, err)
}
