import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createSaucenaoProvider, type FetchLike } from "@/saucenao/saucenao.js"
import type { SaucenaoOutput } from "@/saucenao/saucenao.types.js"
import { describeOsintProvider } from "@/testing/conformance.js"

const ctx = () => ({ lookupId: "test-lookup", signal: new AbortController().signal })

function mockFetch(opts: {
  status?: number
  body?: unknown
  statusText?: string
  bodyText?: string
}): FetchLike {
  return async () => ({
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    json: async () => opts.body ?? {},
    text: async () => opts.bodyText ?? "",
  })
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of it) out.push(v)
  return out
}

const happyResponse = {
  header: {
    status: 0,
    short_remaining: 5,
    long_remaining: 99,
    results_returned: 2,
  },
  results: [
    {
      header: {
        similarity: "95.50",
        thumbnail: "https://img.saucenao.com/thumb1.jpg",
        index_id: 5,
        index_name: "Index #5: Pixiv Images",
      },
      data: {
        ext_urls: ["https://www.pixiv.net/artworks/12345"],
        title: "Example art",
        pixiv_id: 12345,
        member_name: "ExampleArtist",
      },
    },
    {
      header: {
        similarity: "87.20",
        index_id: 41,
        index_name: "Index #41: Twitter",
      },
      data: {
        ext_urls: ["https://twitter.com/alice/status/12345"],
        twitter_user_handle: "alice",
      },
    },
    {
      // Below the 60 default minSimilarity threshold — should be filtered out.
      header: { similarity: "35.10", index_name: "Index #99: Noise" },
      data: { ext_urls: ["https://noise.test/page"] },
    },
  ],
}

describeOsintProvider(createSaucenaoProvider({ fetch: mockFetch({ body: happyResponse }) }), {
  knownGood: { image_url: "https://example.test/avatar.jpg" },
})

describe("saucenaoProvider — happy path", () => {
  it("yields Started then Final with high-similarity matches only", async () => {
    const provider = createSaucenaoProvider({ fetch: mockFetch({ body: happyResponse }) })
    const events = await collect(
      provider.run({ image_url: "https://example.test/avatar.jpg" }, ctx()),
    )
    expect(events[0]).toEqual({ _tag: "Started" })
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<SaucenaoOutput>,
      { _tag: "Final" }
    >
    expect(final.data.matches).toHaveLength(2)
    expect(final.data.matches[0]).toMatchObject({
      similarity: 95.5,
      index_name: "Index #5: Pixiv Images",
      source_urls: ["https://www.pixiv.net/artworks/12345"],
    })
    expect(final.data.matches[1]).toMatchObject({
      twitter_user_handle: "alice",
    })
    expect(final.data.short_remaining).toBe(5)
    expect(final.data.long_remaining).toBe(99)
  })

  it("respects minSimilarity override", async () => {
    const provider = createSaucenaoProvider({
      fetch: mockFetch({ body: happyResponse }),
      minSimilarity: 30, // include the noisy 35.10 entry
    })
    const events = await collect(provider.run({ image_url: "https://example.test/x.jpg" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<SaucenaoOutput>,
      { _tag: "Final" }
    >
    expect(final.data.matches).toHaveLength(3)
  })

  it("returns empty matches for a response with no usable hits", async () => {
    const provider = createSaucenaoProvider({
      fetch: mockFetch({ body: { header: {}, results: [] } }),
    })
    const events = await collect(provider.run({ image_url: "https://example.test/x.jpg" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<SaucenaoOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual({ matches: [], short_remaining: null, long_remaining: null })
  })

  it("appends api_key to the query string only when set", async () => {
    let calledUrl: string | undefined
    const fetch: FetchLike = async (url) => {
      calledUrl = url
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => happyResponse,
        text: async () => "",
      }
    }
    const provider = createSaucenaoProvider({ fetch, apiKey: "test-key-123" })
    await collect(provider.run({ image_url: "https://example.test/x.jpg" }, ctx()))
    expect(calledUrl).toContain("api_key=test-key-123")
  })
})

describe("saucenaoProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on 429", async () => {
    const provider = createSaucenaoProvider({ fetch: mockFetch({ status: 429 }) })
    await expect(
      collect(provider.run({ image_url: "https://example.test/x.jpg" }, ctx())),
    ).rejects.toMatchObject({ name: "ProviderError", kind: "RateLimited" })
  })

  it("rejects non-URL inputs via inputSchema", () => {
    const provider = createSaucenaoProvider()
    expect(() => provider.inputSchema.parse({ image_url: "not-a-url" })).toThrow()
    expect(() =>
      provider.inputSchema.parse({ image_url: "https://example.test/x.jpg" }),
    ).not.toThrow()
  })
})
