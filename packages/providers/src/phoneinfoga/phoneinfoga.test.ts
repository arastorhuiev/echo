import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createPhoneinfogaProvider, type FetchLike } from "@/phoneinfoga/phoneinfoga.js"
import type { PhoneinfogaOutput } from "@/phoneinfoga/phoneinfoga.types.js"
import { describeOsintProvider } from "@/testing/conformance.js"

const ctx = () => ({ lookupId: "test-lookup", signal: new AbortController().signal })

interface MockOptions {
  status?: number
  statusText?: string
  body?: unknown
  bodyText?: string
}

function mockSidecar(opts: MockOptions): FetchLike {
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

const happyResponse: PhoneinfogaOutput = {
  local_scanner: {
    valid: true,
    country: "United Kingdom",
    country_code: "GB",
    carrier: "",
    line_type: "FIXED_LINE",
  },
  google_dorks: [
    "https://www.google.com/search?q=intext%3A%22%2B442079460958%22+site%3Afacebook.com",
    "https://www.google.com/search?q=intext%3A%22%2B442079460958%22+site%3Alinkedin.com",
  ],
  error: null,
}

describeOsintProvider(
  createPhoneinfogaProvider({
    sidecarUrl: "http://test",
    fetch: mockSidecar({ body: happyResponse }),
  }),
  { knownGood: { phone: "+442079460958" } },
)

describe("phoneinfogaProvider — happy path", () => {
  it("yields Started then Final with the sidecar payload", async () => {
    const provider = createPhoneinfogaProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: happyResponse }),
    })
    const events = await collect(provider.run({ phone: "+442079460958" }, ctx()))

    expect(events[0]).toEqual({ _tag: "Started" })
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<PhoneinfogaOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual(happyResponse)
    expect(final.data.google_dorks).toHaveLength(2)
  })

  it("treats subprocess error as a Final with error field set (not a throw)", async () => {
    const errorBody: PhoneinfogaOutput = {
      local_scanner: null,
      google_dorks: [],
      error: "phoneinfoga exited 127: command not found",
    }
    const provider = createPhoneinfogaProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: errorBody }),
    })
    const events = await collect(provider.run({ phone: "+1" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<PhoneinfogaOutput>,
      { _tag: "Final" }
    >
    expect(final.data.error).toMatch(/exited 127/)
    expect(final.data.local_scanner).toBeNull()
  })
})

describe("phoneinfogaProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on sidecar 429", async () => {
    const provider = createPhoneinfogaProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ status: 429 }),
    })
    await expect(collect(provider.run({ phone: "+1" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("throws ProviderError(Network) on sidecar 502", async () => {
    const provider = createPhoneinfogaProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ status: 502 }),
    })
    await expect(collect(provider.run({ phone: "+1" }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("throws ProviderError(Parse) when sidecar payload fails schema", async () => {
    const provider = createPhoneinfogaProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: { local_scanner: "not-an-object" } }),
    })
    await expect(collect(provider.run({ phone: "+1" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "Parse",
    })
  })

  it("rejects empty phone via inputSchema", () => {
    const provider = createPhoneinfogaProvider({ sidecarUrl: "http://test" })
    expect(() => provider.inputSchema.parse({ phone: "" })).toThrow()
    expect(() => provider.inputSchema.parse({ phone: "+442079460958" })).not.toThrow()
  })
})
