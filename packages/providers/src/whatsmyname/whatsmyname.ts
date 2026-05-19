import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError, type ProviderErrorKind } from "@/core/provider.js"
import { filterSupportedSites, loadWmnDataset } from "@/whatsmyname/whatsmyname.dataset.js"
import {
  type WhatsmynameFoundEntry,
  type WhatsmynameInput,
  type WhatsmynameOutput,
  type WmnDataset,
  type WmnSite,
  whatsmynameInputSchema,
  whatsmynameOutputSchema,
} from "@/whatsmyname/whatsmyname.types.js"

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
  text: () => Promise<string>
}>

export interface WhatsmynameProviderDeps {
  readonly fetch?: FetchLike
  /**
   * Optional dataset override. Pass an absolute path to load from a
   * non-default file (rarely needed) or a fully-parsed `WmnDataset` to
   * skip I/O entirely (tests use this). Default = vendored dataset.
   */
  readonly dataset?: string | WmnDataset
  /** Max concurrent outbound HTTP requests. Default 32. */
  readonly concurrency?: number
  /** Per-site request timeout in ms. Default 5000. */
  readonly perSiteTimeoutMs?: number
}

const DEFAULT_CONCURRENCY = 32
const DEFAULT_PER_SITE_TIMEOUT_MS = 5_000
const MAX_BODY_BYTES = 256 * 1024 // truncate responses past 256 KB — most match-strings sit near the top

/**
 * WhatsMyName username-hunting provider — fans out HTTP GET against
 * ~700 vendored site definitions and matches the canonical
 * `e_string` / `m_string` heuristics. Runs entirely in-process; the
 * Python sidecar never sees a request. The dataset itself is vendored
 * under `wmn-data.json` (CC-BY-SA-4.0; see field `license` inside the
 * file for attribution).
 *
 * Matching rule per site (mirrors the upstream README):
 *   FOUND      = status === e_code AND body contains e_string
 *   NOT FOUND  = status === m_code AND body contains m_string
 *   AMBIGUOUS  = neither — skipped, not counted in `checked`
 */
export function createWhatsmynameProvider(
  deps: WhatsmynameProviderDeps = {},
): OsintProvider<WhatsmynameInput, WhatsmynameOutput> {
  const fetchImpl: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY
  const perSiteTimeoutMs = deps.perSiteTimeoutMs ?? DEFAULT_PER_SITE_TIMEOUT_MS
  const datasetSource = deps.dataset

  return {
    id: "whatsmyname",
    category: "username",
    inputSchema: whatsmynameInputSchema,
    outputSchema: whatsmynameOutputSchema,
    defaults: defaultsFor("username", {
      timeoutMs: 120_000,
      maxConcurrent: 2,
      cacheTtlSec: 24 * 3_600,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    }),

    async *run(query, ctx) {
      yield { _tag: "Started" }

      let dataset: Awaited<ReturnType<typeof loadWmnDataset>>
      try {
        dataset = await loadWmnDataset(datasetSource)
      } catch (err) {
        throw toProviderError(err, "Parse", "wmn dataset load failed")
      }

      const sites = filterSupportedSites(dataset.sites)
      const found: WhatsmynameFoundEntry[] = []
      let checked = 0

      for (let i = 0; i < sites.length; i += concurrency) {
        if (ctx.signal.aborted) break
        const chunk = sites.slice(i, i + concurrency)
        const results = await Promise.allSettled(
          chunk.map((site) =>
            checkSite(site, query.username, {
              fetchImpl,
              parentSignal: ctx.signal,
              perSiteTimeoutMs,
            }),
          ),
        )
        for (const r of results) {
          if (r.status !== "fulfilled") continue
          const outcome = r.value
          if (outcome.kind === "found") {
            found.push(outcome.entry)
            checked += 1
            yield { _tag: "Partial", chunk: outcome.entry }
          } else if (outcome.kind === "not_found") {
            checked += 1
          }
          // ambiguous / network-error sites don't count toward `checked`
        }
      }

      yield { _tag: "Final", data: { found, checked, total: sites.length } }
    },
  }
}

interface CheckDeps {
  readonly fetchImpl: FetchLike
  readonly parentSignal: AbortSignal
  readonly perSiteTimeoutMs: number
}

type SiteOutcome =
  | { kind: "found"; entry: WhatsmynameFoundEntry }
  | { kind: "not_found" }
  | { kind: "ambiguous" }
  | { kind: "error" }

async function checkSite(site: WmnSite, username: string, deps: CheckDeps): Promise<SiteOutcome> {
  const url = renderUri(site.uri_check, username)
  const ctrl = combinedAbort(deps.parentSignal, deps.perSiteTimeoutMs)

  let response: Awaited<ReturnType<FetchLike>>
  try {
    response = await deps.fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        // Some sites cloak content for default browser UAs; a generic Chrome UA gets us past 90% of them.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        ...(site.headers ?? {}),
      },
      signal: ctrl.signal,
    })
  } catch {
    return { kind: "error" }
  } finally {
    ctrl.cleanup()
  }

  // Read body once with a size cap; both e_string and m_string searches
  // walk the same buffer so we never read twice.
  let body: string
  try {
    body = (await response.text()).slice(0, MAX_BODY_BYTES)
  } catch {
    return { kind: "error" }
  }

  const statusMatchesFound = response.status === site.e_code
  const statusMatchesMissing = response.status === site.m_code
  const bodyHasFoundMarker = body.includes(site.e_string)
  const bodyHasMissingMarker = body.includes(site.m_string)

  if (statusMatchesFound && bodyHasFoundMarker) {
    return {
      kind: "found",
      entry: {
        name: site.name,
        url: renderUri(site.uri_pretty ?? site.uri_check, username),
        category: site.cat,
      },
    }
  }
  if (statusMatchesMissing || bodyHasMissingMarker) return { kind: "not_found" }
  return { kind: "ambiguous" }
}

/**
 * `combinedAbort` returns a signal that fires when EITHER the parent
 * (lookup-level cancellation) fires OR the per-site timeout elapses.
 * `cleanup()` must be called in a `finally` to unhook the timer.
 */
function combinedAbort(
  parent: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController()
  if (parent.aborted) ctrl.abort()
  const onParentAbort = () => ctrl.abort()
  parent.addEventListener("abort", onParentAbort)
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  return {
    signal: ctrl.signal,
    cleanup: () => {
      parent.removeEventListener("abort", onParentAbort)
      clearTimeout(timer)
    },
  }
}

function renderUri(template: string, username: string): string {
  // WhatsMyName uses `{account}` as the placeholder. `replaceAll`
  // because some templates have it more than once (e.g. profile + API).
  return template.replaceAll("{account}", username)
}

function toProviderError(err: unknown, fallback: ProviderErrorKind, prefix: string): ProviderError {
  if (err instanceof ProviderError) return err
  const message = err instanceof Error ? err.message : String(err)
  return new ProviderError("whatsmyname", fallback, `${prefix}: ${message}`, err)
}
