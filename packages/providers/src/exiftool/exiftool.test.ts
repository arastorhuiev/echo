import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createExiftoolProvider, type FetchLike } from "@/exiftool/exiftool.js"
import type { ExiftoolOutput } from "@/exiftool/exiftool.types.js"
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

const richResponse: ExiftoolOutput = {
  found: true,
  file_type: "JPEG",
  mime_type: "image/jpeg",
  width: 4032,
  height: 3024,
  make: "Apple",
  model: "iPhone 14 Pro",
  lens_model: "iPhone 14 Pro back triple camera 6.86mm f/1.78",
  software: "17.5",
  date_taken: "2026:03:14 09:21:11",
  gps_latitude: "37 deg 24' 35.40\" N",
  gps_longitude: "122 deg 5' 28.20\" W",
  gps_altitude: "12 m Above Sea Level",
  gps_date: "2026:03:14",
  byline: null,
  credit: null,
  source: null,
  copyright: null,
  creator: null,
  rights: null,
  error: null,
}

describeOsintProvider(
  createExiftoolProvider({
    sidecarUrl: "http://test",
    fetch: mockSidecar({ body: richResponse }),
  }),
  { knownGood: { image_url: "https://example.test/photo.jpg" } },
)

describe("exiftoolProvider — happy path", () => {
  it("yields Started then Final with the slim payload", async () => {
    const provider = createExiftoolProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: richResponse }),
    })
    const events = await collect(
      provider.run({ image_url: "https://example.test/photo.jpg" }, ctx()),
    )
    expect(events[0]).toEqual({ _tag: "Started" })
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<ExiftoolOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toMatchObject({
      found: true,
      make: "Apple",
      model: "iPhone 14 Pro",
      gps_latitude: "37 deg 24' 35.40\" N",
      width: 4032,
      height: 3024,
    })
  })

  it("surfaces a download failure as a Final with error set", async () => {
    const provider = createExiftoolProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({
        body: {
          found: false,
          error: "image fetch failed: ConnectError",
        },
      }),
    })
    const events = await collect(provider.run({ image_url: "https://broken.test/x.jpg" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<ExiftoolOutput>,
      { _tag: "Final" }
    >
    expect(final.data.found).toBe(false)
    expect(final.data.error).toMatch(/fetch failed/i)
  })
})

describe("exiftoolProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on sidecar 429", async () => {
    const provider = createExiftoolProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ status: 429 }),
    })
    await expect(
      collect(provider.run({ image_url: "https://example.test/x.jpg" }, ctx())),
    ).rejects.toMatchObject({ name: "ProviderError", kind: "RateLimited" })
  })

  it("throws ProviderError(Parse) on malformed sidecar JSON", async () => {
    const provider = createExiftoolProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: { found: "not-a-bool" } }),
    })
    await expect(
      collect(provider.run({ image_url: "https://example.test/x.jpg" }, ctx())),
    ).rejects.toBeInstanceOf(ProviderError)
  })

  it("rejects non-URL inputs via inputSchema", () => {
    const provider = createExiftoolProvider({ sidecarUrl: "http://test" })
    expect(() => provider.inputSchema.parse({ image_url: "not-a-url" })).toThrow()
    expect(() =>
      provider.inputSchema.parse({ image_url: "https://example.test/x.jpg" }),
    ).not.toThrow()
  })
})
