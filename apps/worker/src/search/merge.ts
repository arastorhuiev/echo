/** Terminal state of one fan-out child, as seen by the aggregator. */
export interface ChildResult {
  readonly providerId: string
  readonly status: "done" | "failed" | "cancelled"
  /** The child's `Final.data` (only for status "done"). */
  readonly data?: unknown
  /** Error message (only for status "failed"). */
  readonly error?: string
}

export interface MergedAccount {
  readonly url: string
  readonly site?: string
  /** Provider ids that independently surfaced this account (correlation signal). */
  readonly sources: string[]
}

export interface SearchReport {
  readonly identifier: string
  readonly kind: string
  readonly providersRun: number
  readonly providersSucceeded: number
  readonly providersFailed: number
  /** Deduped accounts/profiles correlated across providers by URL. */
  readonly accounts: MergedAccount[]
  /** Per-provider terminal status (raw data omitted here — it lives in lookup_events). */
  readonly providers: ReadonlyArray<{ providerId: string; status: string; error?: string }>
}

/**
 * Merge every child's terminal result into one deduped report (P12). Accounts
 * are pulled from the common `Final.data.found[]` shape (sherlock / maigret /
 * whatsmyname all emit `{ url, name, ... }`) and deduped by a normalized URL,
 * with each contributing provider recorded in `sources` — so a profile found
 * by three engines reads as one high-confidence hit, not three rows.
 *
 * A failed/cancelled child never fails the whole search; it's counted and
 * listed with its status.
 */
export function mergeSearchReport(
  identifier: string,
  kind: string,
  children: ReadonlyArray<ChildResult>,
): SearchReport {
  const byUrl = new Map<string, { url: string; site?: string; sources: Set<string> }>()

  for (const child of children) {
    if (child.status !== "done") continue
    for (const account of extractAccounts(child.data)) {
      const key = normalizeUrl(account.url)
      const existing = byUrl.get(key)
      if (existing) {
        existing.sources.add(child.providerId)
        if (!existing.site && account.site) existing.site = account.site
      } else {
        byUrl.set(key, {
          url: account.url,
          site: account.site,
          sources: new Set([child.providerId]),
        })
      }
    }
  }

  const accounts: MergedAccount[] = [...byUrl.values()]
    .map((a) => ({
      url: a.url,
      ...(a.site !== undefined ? { site: a.site } : {}),
      sources: [...a.sources].sort(),
    }))
    .sort((a, b) => a.url.localeCompare(b.url))

  return {
    identifier,
    kind,
    providersRun: children.length,
    providersSucceeded: children.filter((c) => c.status === "done").length,
    providersFailed: children.filter((c) => c.status === "failed").length,
    accounts,
    providers: children.map((c) => ({
      providerId: c.providerId,
      status: c.status,
      ...(c.error !== undefined ? { error: c.error } : {}),
    })),
  }
}

interface RawAccount {
  url: string
  site?: string
}

function extractAccounts(data: unknown): RawAccount[] {
  const found = (data as { found?: unknown })?.found
  if (!Array.isArray(found)) return []
  const out: RawAccount[] = []
  for (const entry of found) {
    if (typeof entry !== "object" || entry === null) continue
    const url = (entry as { url?: unknown }).url
    if (typeof url !== "string" || url.length === 0) continue
    const name =
      (entry as { name?: unknown; site?: unknown }).name ?? (entry as { site?: unknown }).site
    out.push({ url, ...(typeof name === "string" ? { site: name } : {}) })
  }
  return out
}

/** Dedupe key: drop scheme, lowercase, trim a trailing slash. */
function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
}
