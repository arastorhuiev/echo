import { createHash } from "node:crypto"
import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import {
  type GravatarInput,
  type GravatarOutput,
  type GravatarProfile,
  gravatarInputSchema,
  gravatarOutputSchema,
  gravatarProfileSchema,
} from "@/gravatar/gravatar.types.js"

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

export interface GravatarProviderDeps {
  readonly fetch?: FetchLike
  /** Override the API base; primarily for tests. Defaults to api.gravatar.com. */
  readonly baseUrl?: string
}

const DEFAULT_BASE_URL = "https://api.gravatar.com/v3"

/**
 * Gravatar profile lookup — public REST v3 API, no auth.
 *
 * Identifier is SHA-256 of the trimmed lowercase email. A `200` returns
 * the public profile; a `404` means no Gravatar attached to that email.
 * We translate `404` into `{ found: false, hash }` rather than throwing,
 * because absence is a legitimate result the UI surfaces ("no public
 * Gravatar profile") — not a provider failure.
 */
export function createGravatarProvider(
  deps: GravatarProviderDeps = {},
): OsintProvider<GravatarInput, GravatarOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")

  return {
    id: "gravatar",
    category: "email",
    inputSchema: gravatarInputSchema,
    outputSchema: gravatarOutputSchema,
    defaults: defaultsFor("email", {
      timeoutMs: 10_000,
      maxConcurrent: 8,
      cacheTtlSec: 24 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      const hash = sha256Hex(query.email.trim().toLowerCase())
      const url = `${baseUrl}/profiles/${hash}`

      let response: Awaited<ReturnType<FetchLike>>
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: ctx.signal,
        })
      } catch (err) {
        throw toProviderError(err, "Network", "gravatar fetch failed")
      }

      if (response.status === 404) {
        yield { _tag: "Final", data: { hash, found: false } }
        return
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new ProviderError(
          "gravatar",
          mapHttpStatusToKind(response.status),
          `gravatar returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
        )
      }

      let raw: unknown
      try {
        raw = await response.json()
      } catch (err) {
        throw toProviderError(err, "Parse", "gravatar response was not valid JSON")
      }

      // Gravatar returns a flat object — we keep only the documented
      // fields we surface in the UI and drop everything else.
      const profile = pickProfileFields(raw)
      const parsed = gravatarProfileSchema.safeParse(profile)
      if (!parsed.success) {
        throw new ProviderError(
          "gravatar",
          "Parse",
          `gravatar profile failed schema: ${parsed.error.message.slice(0, 200)}`,
        )
      }

      yield { _tag: "Final", data: { hash, found: true, profile: parsed.data } }
    },
  }
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function pickProfileFields(raw: unknown): GravatarProfile {
  if (raw === null || typeof raw !== "object") return {}
  const r = raw as Record<string, unknown>
  const profile: GravatarProfile = {}
  for (const key of [
    "display_name",
    "profile_url",
    "avatar_url",
    "avatar_alt_text",
    "location",
    "description",
    "job_title",
    "company",
    "pronouns",
    "pronunciation",
  ] as const) {
    const v = r[key]
    if (typeof v === "string" && v.length > 0) profile[key] = v
  }
  if (Array.isArray(r.verified_accounts)) {
    const accounts: GravatarProfile["verified_accounts"] = []
    for (const a of r.verified_accounts) {
      if (a !== null && typeof a === "object") {
        const ar = a as Record<string, unknown>
        if (typeof ar.service_type === "string" && typeof ar.url === "string") {
          accounts.push({
            service_type: ar.service_type,
            service_label: typeof ar.service_label === "string" ? ar.service_label : undefined,
            url: ar.url,
          })
        }
      }
    }
    if (accounts.length > 0) profile.verified_accounts = accounts
  }
  return profile
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
  return new ProviderError("gravatar", kind, `${prefix}: ${message}`, err)
}
