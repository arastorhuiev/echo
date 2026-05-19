import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { describeOsintProvider } from "@/testing/conformance.js"
import { createTruecallerProvider, type FetchLike } from "@/truecaller/truecaller.js"
import type { TruecallerOutput } from "@/truecaller/truecaller.types.js"

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

const happyResponse: TruecallerOutput = {
  configured: true,
  found: true,
  name: "John Smith",
  alt_name: null,
  image_url: "https://example.test/avatar.jpg",
  gender: "M",
  addresses: [{ city: "London", country_code: "GB", address: "" }],
  emails: ["john@example.test"],
  tags: ["plumber"],
  spam_info: { spam_score: 0, spam_type: null },
  score: 0.5,
  access: "PUBLIC",
  enhanced: true,
  error: null,
}

describeOsintProvider(
  createTruecallerProvider({
    sidecarUrl: "http://test",
    fetch: mockSidecar({ body: happyResponse }),
  }),
  { knownGood: { phone: "+442079460958", country_code: "GB" } },
)

describe("truecallerProvider — happy path", () => {
  it("yields Started then Final with the normalised payload", async () => {
    const provider = createTruecallerProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: happyResponse }),
    })
    const events = await collect(
      provider.run({ phone: "+442079460958", country_code: "GB" }, ctx()),
    )
    expect(events[0]).toEqual({ _tag: "Started" })
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<TruecallerOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toMatchObject({
      configured: true,
      found: true,
      name: "John Smith",
      tags: ["plumber"],
    })
  })
})

describe("truecallerProvider — env-conditional path", () => {
  it("surfaces configured=false as a normal Final", async () => {
    const provider = createTruecallerProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({
        body: {
          configured: false,
          found: false,
          addresses: [],
          emails: [],
          tags: [],
          error: "Truecaller lookup not configured.",
        },
      }),
    })
    const events = await collect(provider.run({ phone: "+1" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<TruecallerOutput>,
      { _tag: "Final" }
    >
    expect(final.data.configured).toBe(false)
    expect(final.data.error).toMatch(/not configured/i)
  })

  it("surfaces configured=true + truecallerpy error as a normal Final", async () => {
    const provider = createTruecallerProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({
        body: {
          configured: true,
          found: false,
          addresses: [],
          emails: [],
          tags: [],
          error: "truecallerpy error: HTTP 401 from Truecaller",
        },
      }),
    })
    const events = await collect(provider.run({ phone: "+1" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<TruecallerOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toMatchObject({
      configured: true,
      found: false,
      error: expect.stringContaining("HTTP 401") as unknown as string,
    })
  })
})

describe("truecallerProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on sidecar 429", async () => {
    const provider = createTruecallerProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ status: 429 }),
    })
    await expect(collect(provider.run({ phone: "+1" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("throws ProviderError(Parse) on malformed sidecar JSON", async () => {
    const provider = createTruecallerProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: { configured: "not-bool" } }),
    })
    await expect(collect(provider.run({ phone: "+1" }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("rejects empty phone via inputSchema", () => {
    const provider = createTruecallerProvider({ sidecarUrl: "http://test" })
    expect(() => provider.inputSchema.parse({ phone: "" })).toThrow()
    expect(() =>
      provider.inputSchema.parse({ phone: "+442079460958", country_code: "GB" }),
    ).not.toThrow()
  })
})
