import { describe, expect, it } from "vitest"
import type { ProviderEvent } from "@/core/provider.js"
import { describeOsintProvider } from "@/testing/conformance.js"
import { createWhatsmynameProvider, type FetchLike } from "@/whatsmyname/whatsmyname.js"
import type { WhatsmynameOutput, WmnDataset } from "@/whatsmyname/whatsmyname.types.js"

const ctx = () => ({ lookupId: "test-lookup", signal: new AbortController().signal })

const fixture: WmnDataset = {
  license: ["test fixture, not the real WMN license"],
  categories: ["coding", "social", "video"],
  sites: [
    {
      name: "GitHub",
      uri_check: "https://github.com/{account}",
      uri_pretty: "https://github.com/{account}",
      e_code: 200,
      e_string: "github-profile-marker",
      m_string: "Not Found",
      m_code: 404,
      cat: "coding",
    },
    {
      name: "MissingSite",
      uri_check: "https://miss.test/{account}",
      e_code: 200,
      e_string: "profile",
      m_string: "user-not-found",
      m_code: 404,
      cat: "social",
    },
    {
      name: "AmbiguousSite",
      uri_check: "https://ambig.test/{account}",
      e_code: 200,
      e_string: "definitely-not-in-body",
      m_string: "also-not-here",
      m_code: 404,
      cat: "social",
    },
    {
      name: "PostOnlySite",
      uri_check: "https://post-only.test/{account}",
      e_code: 200,
      e_string: "hello",
      m_string: "bye",
      m_code: 404,
      cat: "social",
      post_body: "username={account}", // filtered out
    },
  ],
}

/**
 * Build a fetch that routes by hostname → fixed status + body. Sites
 * not in the map yield a network error (default).
 */
function routerFetch(routes: Record<string, { status: number; body: string }>): FetchLike {
  return async (url) => {
    const host = new URL(url).host
    const route = routes[host]
    if (!route) throw new Error(`mock: no route for ${host}`)
    return {
      ok: route.status < 400,
      status: route.status,
      text: async () => route.body,
    }
  }
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of it) out.push(v)
  return out
}

const happyFetch = routerFetch({
  "github.com": { status: 200, body: "<html><body>github-profile-marker</body></html>" },
  "miss.test": { status: 404, body: "user-not-found" },
  "ambig.test": { status: 200, body: "<html>nothing useful</html>" },
})

describeOsintProvider(createWhatsmynameProvider({ fetch: happyFetch, dataset: fixture }), {
  knownGood: { username: "anthropic" },
})

describe("whatsmynameProvider — matching rules", () => {
  it("yields Partial per FOUND site and accumulates them in Final", async () => {
    const provider = createWhatsmynameProvider({ fetch: happyFetch, dataset: fixture })
    const events = await collect(provider.run({ username: "anthropic" }, ctx()))

    const partials = events.filter((e) => e._tag === "Partial")
    expect(partials).toHaveLength(1)
    expect(partials[0]).toEqual({
      _tag: "Partial",
      chunk: {
        name: "GitHub",
        url: "https://github.com/anthropic",
        category: "coding",
      },
    })

    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<WhatsmynameOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual({
      found: [{ name: "GitHub", url: "https://github.com/anthropic", category: "coding" }],
      // Github matched FOUND, miss.test matched NOT_FOUND, ambig.test was AMBIGUOUS (not counted),
      // post-only-site was filtered out before fan-out.
      checked: 2,
      total: 3,
    })
  })

  it("treats an ambiguous response (neither e_string nor m_string) as uncounted", async () => {
    const provider = createWhatsmynameProvider({
      fetch: routerFetch({
        "github.com": { status: 200, body: "neither marker present" },
        "miss.test": { status: 200, body: "neither marker present" },
        "ambig.test": { status: 200, body: "neither marker present" },
      }),
      dataset: fixture,
    })
    const events = await collect(provider.run({ username: "x" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<WhatsmynameOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual({ found: [], checked: 0, total: 3 })
  })

  it("uses uri_pretty for the surfaced URL when present", async () => {
    const provider = createWhatsmynameProvider({
      fetch: routerFetch({
        "github.com": { status: 200, body: "github-profile-marker" },
        "miss.test": { status: 404, body: "user-not-found" },
        "ambig.test": { status: 404, body: "user-not-found" },
      }),
      dataset: {
        sites: [
          {
            name: "GitHub",
            uri_check: "https://github.com/api/users/{account}",
            uri_pretty: "https://github.com/{account}",
            e_code: 200,
            e_string: "github-profile-marker",
            m_string: "Not Found",
            m_code: 404,
            cat: "coding",
          },
        ],
      },
    })
    const events = await collect(provider.run({ username: "torvalds" }, ctx()))
    const partial = events.find((e) => e._tag === "Partial") as Extract<
      ProviderEvent<WhatsmynameOutput>,
      { _tag: "Partial" }
    >
    expect(partial.chunk).toMatchObject({
      url: "https://github.com/torvalds",
    })
  })

  it("filters out sites with post_body before fan-out", async () => {
    // PostOnlySite is in the fixture; we should never see a request for it.
    const seenHosts: string[] = []
    const fetch: FetchLike = async (url) => {
      seenHosts.push(new URL(url).host)
      return { ok: true, status: 200, text: async () => "github-profile-marker" }
    }
    const provider = createWhatsmynameProvider({ fetch, dataset: fixture })
    await collect(provider.run({ username: "x" }, ctx()))
    expect(seenHosts).not.toContain("post-only.test")
    expect(seenHosts).toContain("github.com")
  })
})

describe("whatsmynameProvider — network errors per site", () => {
  it("swallows per-site network errors and continues", async () => {
    const provider = createWhatsmynameProvider({
      fetch: async (url) => {
        if (new URL(url).host === "github.com") throw new Error("connect ECONNREFUSED")
        if (new URL(url).host === "miss.test") {
          return { ok: false, status: 404, text: async () => "user-not-found" }
        }
        return { ok: true, status: 200, text: async () => "nothing here" }
      },
      dataset: fixture,
    })
    const events = await collect(provider.run({ username: "x" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<WhatsmynameOutput>,
      { _tag: "Final" }
    >
    // github errored (uncounted), miss.test was NOT_FOUND (counted), ambig was AMBIGUOUS (uncounted)
    expect(final.data).toEqual({ found: [], checked: 1, total: 3 })
  })
})

describe("whatsmynameProvider — cancellation", () => {
  it("stops scheduling new chunks once the parent signal aborts", async () => {
    const ctrl = new AbortController()
    let calls = 0
    const provider = createWhatsmynameProvider({
      fetch: async () => {
        calls += 1
        if (calls === 1) ctrl.abort()
        return { ok: true, status: 200, text: async () => "nothing" }
      },
      dataset: fixture,
      concurrency: 1,
    })
    const events = await collect(
      provider.run({ username: "x" }, { lookupId: "t", signal: ctrl.signal }),
    )
    // With concurrency 1, after the first call we abort — the loop
    // should bail before scheduling the second chunk.
    expect(calls).toBeLessThanOrEqual(2)
    const final = events.find((e) => e._tag === "Final")
    expect(final).toBeDefined()
  })
})

describe("whatsmynameProvider — input validation", () => {
  it("rejects malformed usernames via inputSchema (shares Sherlock regex)", () => {
    const provider = createWhatsmynameProvider({ dataset: fixture })
    expect(() => provider.inputSchema.parse({ username: "" })).toThrow()
    expect(() => provider.inputSchema.parse({ username: "user with space" })).toThrow()
    expect(() => provider.inputSchema.parse({ username: "ok_user.123" })).not.toThrow()
  })
})
