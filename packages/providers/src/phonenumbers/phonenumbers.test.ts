import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createPhonenumbersProvider, type FetchLike } from "@/phonenumbers/phonenumbers.js"
import type { PhonenumbersOutput } from "@/phonenumbers/phonenumbers.types.js"
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

const validUkResponse: PhonenumbersOutput = {
  valid: true,
  possible: true,
  e164: "+442079460958",
  national_format: "020 7946 0958",
  international_format: "+44 20 7946 0958",
  country_code: 44,
  region_code: "GB",
  number_type: "FIXED_LINE",
  carrier_name: "",
  geocoded_location: "London",
  timezones: ["Europe/London"],
  parse_error: null,
}

const invalidResponse: PhonenumbersOutput = {
  valid: false,
  possible: false,
  e164: null,
  national_format: null,
  international_format: null,
  country_code: null,
  region_code: null,
  number_type: "UNKNOWN",
  carrier_name: "",
  geocoded_location: "",
  timezones: [],
  parse_error: "(0) Invalid country calling code",
}

describeOsintProvider(
  createPhonenumbersProvider({
    sidecarUrl: "http://test",
    fetch: mockSidecar({ body: validUkResponse }),
  }),
  { knownGood: { phone: "+442079460958" } },
)

describe("phonenumbersProvider — valid number", () => {
  it("yields Started then Final with the canonical sidecar payload", async () => {
    const provider = createPhonenumbersProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: validUkResponse }),
    })
    const events = await collect(provider.run({ phone: "+442079460958" }, ctx()))

    expect(events[0]).toEqual({ _tag: "Started" })
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<PhonenumbersOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual(validUkResponse)
  })
})

describe("phonenumbersProvider — invalid number is a Final, not a throw", () => {
  it("returns valid: false with parse_error populated", async () => {
    const provider = createPhonenumbersProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: invalidResponse }),
    })
    const events = await collect(provider.run({ phone: "not-a-number" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<PhonenumbersOutput>,
      { _tag: "Final" }
    >
    expect(final.data.valid).toBe(false)
    expect(final.data.parse_error).toMatch(/Invalid/)
    expect(final.data.e164).toBeNull()
  })
})

describe("phonenumbersProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on 429", async () => {
    const provider = createPhonenumbersProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ status: 429, statusText: "Too Many Requests" }),
    })
    await expect(collect(provider.run({ phone: "+1" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("throws ProviderError(Network) on 502", async () => {
    const provider = createPhonenumbersProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ status: 502 }),
    })
    await expect(collect(provider.run({ phone: "+1" }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("throws ProviderError(Parse) when sidecar payload fails schema", async () => {
    const provider = createPhonenumbersProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: { valid: "not-a-boolean" } }),
    })
    await expect(collect(provider.run({ phone: "+1" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "Parse",
    })
  })

  it("rejects empty phone via inputSchema", () => {
    const provider = createPhonenumbersProvider({ sidecarUrl: "http://test" })
    expect(() => provider.inputSchema.parse({ phone: "" })).toThrow()
    expect(() => provider.inputSchema.parse({ phone: "+442079460958" })).not.toThrow()
  })
})
