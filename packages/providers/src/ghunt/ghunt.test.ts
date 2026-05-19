import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createGhuntProvider, type FetchLike } from "@/ghunt/ghunt.js"
import type { GhuntOutput } from "@/ghunt/ghunt.types.js"
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

const happyResponse: GhuntOutput = {
  configured: true,
  found: true,
  name: "Alex",
  gaia_id: "1102345678901234567890",
  profile_picture: "https://lh3.googleusercontent.com/a/...",
  cover_photo: null,
  emails: ["alex@example.test"],
  reviews_count: 12,
  maps_contributions: 4,
  calendar_visible: false,
  error: null,
}

describeOsintProvider(
  createGhuntProvider({
    sidecarUrl: "http://test",
    fetch: mockSidecar({ body: happyResponse }),
  }),
  { knownGood: { email: "alex@example.test" } },
)

describe("ghuntProvider — happy path", () => {
  it("yields Started then Final with the normalised payload", async () => {
    const provider = createGhuntProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: happyResponse }),
    })
    const events = await collect(provider.run({ email: "alex@example.test" }, ctx()))
    expect(events[0]).toEqual({ _tag: "Started" })
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<GhuntOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toMatchObject({
      configured: true,
      found: true,
      name: "Alex",
      gaia_id: "1102345678901234567890",
      reviews_count: 12,
    })
  })
})

describe("ghuntProvider — env-conditional path", () => {
  it("surfaces configured=false as a normal Final", async () => {
    const provider = createGhuntProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({
        body: {
          configured: false,
          found: false,
          emails: [],
          error: "GHunt not configured. Set GHUNT_CREDS_PATH...",
        },
      }),
    })
    const events = await collect(provider.run({ email: "x@example.com" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<GhuntOutput>,
      { _tag: "Final" }
    >
    expect(final.data.configured).toBe(false)
    expect(final.data.error).toMatch(/not configured/i)
  })

  it("surfaces configured=true + GHunt subprocess error as a normal Final", async () => {
    const provider = createGhuntProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({
        body: {
          configured: true,
          found: false,
          emails: [],
          error: "ghunt exited 1: cookies invalidated, re-login required",
        },
      }),
    })
    const events = await collect(provider.run({ email: "x@example.com" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<GhuntOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toMatchObject({
      configured: true,
      found: false,
      error: expect.stringContaining("re-login") as unknown as string,
    })
  })
})

describe("ghuntProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on sidecar 429", async () => {
    const provider = createGhuntProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ status: 429 }),
    })
    await expect(collect(provider.run({ email: "x@example.com" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("throws ProviderError(Parse) on malformed sidecar JSON", async () => {
    const provider = createGhuntProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: { configured: "not-bool" } }),
    })
    await expect(collect(provider.run({ email: "x@example.com" }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("rejects malformed email via inputSchema", () => {
    const provider = createGhuntProvider({ sidecarUrl: "http://test" })
    expect(() => provider.inputSchema.parse({ email: "not-an-email" })).toThrow()
    expect(() => provider.inputSchema.parse({ email: "x@example.com" })).not.toThrow()
  })
})
