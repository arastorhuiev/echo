import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createSocidExtractorProvider, type FetchLike } from "@/socid-extractor/socid-extractor.js"
import type { SocidExtractorOutput } from "@/socid-extractor/socid-extractor.types.js"
import { describeOsintProvider } from "@/testing/conformance.js"

const ctx = () => ({ lookupId: "test-lookup", signal: new AbortController().signal })

function mockSidecar(opts: {
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

const tgResponse: SocidExtractorOutput = {
  found: true,
  url: "https://t.me/durov",
  fields: {
    telegram_id: "1",
    fullname: "Pavel Durov",
    username: "durov",
    bio: "Telegram founder",
    links: ["https://example.test/a", "https://example.test/b"],
  },
  error: null,
}

describeOsintProvider(
  createSocidExtractorProvider({
    sidecarUrl: "http://test",
    fetch: mockSidecar({ body: tgResponse }),
  }),
  { knownGood: { url: "https://t.me/durov" } },
)

describe("socidExtractorProvider — happy path", () => {
  it("yields Started then Final with extracted fields", async () => {
    const provider = createSocidExtractorProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: tgResponse }),
    })
    const events = await collect(provider.run({ url: "https://t.me/durov" }, ctx()))
    expect(events[0]).toEqual({ _tag: "Started" })
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<SocidExtractorOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toMatchObject({
      found: true,
      url: "https://t.me/durov",
      fields: {
        telegram_id: "1",
        fullname: "Pavel Durov",
      },
    })
    expect(final.data.fields.links).toEqual(["https://example.test/a", "https://example.test/b"])
  })

  it("handles URLs the extractor doesn't recognise (found=false, empty fields)", async () => {
    const provider = createSocidExtractorProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({
        body: { found: false, url: "https://random.test/page", fields: {}, error: null },
      }),
    })
    const events = await collect(provider.run({ url: "https://random.test/page" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<SocidExtractorOutput>,
      { _tag: "Final" }
    >
    expect(final.data.found).toBe(false)
    expect(final.data.fields).toEqual({})
  })

  it("surfaces upstream fetch errors as a Final with error set (not a throw)", async () => {
    const provider = createSocidExtractorProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({
        body: {
          found: false,
          url: "https://broken.test",
          fields: {},
          error: "fetch failed: ConnectError",
        },
      }),
    })
    const events = await collect(provider.run({ url: "https://broken.test" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<SocidExtractorOutput>,
      { _tag: "Final" }
    >
    expect(final.data.found).toBe(false)
    expect(final.data.error).toMatch(/fetch failed/)
  })
})

describe("socidExtractorProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on sidecar 429", async () => {
    const provider = createSocidExtractorProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ status: 429 }),
    })
    await expect(collect(provider.run({ url: "https://t.me/durov" }, ctx()))).rejects.toMatchObject(
      { name: "ProviderError", kind: "RateLimited" },
    )
  })

  it("throws ProviderError(Parse) when sidecar payload fails schema", async () => {
    const provider = createSocidExtractorProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: { found: "not-a-bool" } }),
    })
    await expect(
      collect(provider.run({ url: "https://t.me/durov" }, ctx())),
    ).rejects.toBeInstanceOf(ProviderError)
  })

  it("rejects non-URL input via inputSchema", () => {
    const provider = createSocidExtractorProvider({ sidecarUrl: "http://test" })
    expect(() => provider.inputSchema.parse({ url: "not-a-url" })).toThrow()
    expect(() => provider.inputSchema.parse({ url: "https://t.me/durov" })).not.toThrow()
  })
})
