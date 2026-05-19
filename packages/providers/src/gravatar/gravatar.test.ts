import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createGravatarProvider, type FetchLike } from "@/gravatar/gravatar.js"
import type { GravatarOutput } from "@/gravatar/gravatar.types.js"
import { describeOsintProvider } from "@/testing/conformance.js"

const ctx = () => ({ lookupId: "test-lookup", signal: new AbortController().signal })

interface MockOptions {
  status?: number
  statusText?: string
  body?: unknown
  bodyText?: string
}

function mockFetch(opts: MockOptions): FetchLike {
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

const sampleProfile = {
  display_name: "Jane Doe",
  profile_url: "https://gravatar.com/janedoe",
  avatar_url: "https://gravatar.com/avatar/abc",
  location: "Berlin, DE",
  job_title: "Staff Engineer",
  company: "Stripe",
  verified_accounts: [
    { service_type: "github", service_label: "GitHub", url: "https://github.com/janedoe" },
    { service_type: "mastodon", url: "https://hachyderm.io/@janedoe" },
  ],
  // Field we intentionally drop:
  number_verified_accounts: 2,
  links: [],
}

describeOsintProvider(
  createGravatarProvider({ fetch: mockFetch({ status: 200, body: sampleProfile }) }),
  { knownGood: { email: "jane@example.com" } },
)

describe("gravatarProvider — found path", () => {
  it("yields Started then Final with hash + profile", async () => {
    const provider = createGravatarProvider({
      fetch: mockFetch({ status: 200, body: sampleProfile }),
    })
    const events = await collect(provider.run({ email: "jane@example.com" }, ctx()))
    const expectedHash = createHash("sha256").update("jane@example.com").digest("hex")

    expect(events[0]).toEqual({ _tag: "Started" })
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<GravatarOutput>,
      { _tag: "Final" }
    >
    expect(final).toBeDefined()
    expect(final.data).toMatchObject({
      hash: expectedHash,
      found: true,
      profile: {
        display_name: "Jane Doe",
        location: "Berlin, DE",
        verified_accounts: [
          { service_type: "github", url: "https://github.com/janedoe" },
          { service_type: "mastodon", url: "https://hachyderm.io/@janedoe" },
        ],
      },
    })
    // Field we drop should not appear.
    expect(final.data.profile).not.toHaveProperty("number_verified_accounts")
  })

  it("lower-cases and trims the email before hashing", async () => {
    let calledUrl: string | undefined
    const fetch: FetchLike = async (url) => {
      calledUrl = url
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => sampleProfile,
        text: async () => "",
      }
    }
    const provider = createGravatarProvider({ fetch, baseUrl: "https://api.test/v3" })
    await collect(provider.run({ email: "  Jane@Example.COM  " }, ctx()))
    const expectedHash = createHash("sha256").update("jane@example.com").digest("hex")
    expect(calledUrl).toBe(`https://api.test/v3/profiles/${expectedHash}`)
  })
})

describe("gravatarProvider — not-found path", () => {
  it("returns { found: false } on a 404 — does not throw", async () => {
    const provider = createGravatarProvider({
      fetch: mockFetch({ status: 404, statusText: "Not Found", bodyText: "no profile" }),
    })
    const events = await collect(provider.run({ email: "ghost@example.com" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<GravatarOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual({
      hash: createHash("sha256").update("ghost@example.com").digest("hex"),
      found: false,
    })
  })
})

describe("gravatarProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on 429", async () => {
    const provider = createGravatarProvider({
      fetch: mockFetch({ status: 429, statusText: "Too Many Requests" }),
    })
    await expect(collect(provider.run({ email: "x@example.com" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("throws ProviderError(Network) on 503", async () => {
    const provider = createGravatarProvider({
      fetch: mockFetch({ status: 503, statusText: "Service Unavailable" }),
    })
    await expect(collect(provider.run({ email: "x@example.com" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "Network",
    })
  })

  it("throws ProviderError(Parse) when JSON is malformed", async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        throw new SyntaxError("Unexpected token")
      },
      text: async () => "",
    })
    const provider = createGravatarProvider({ fetch })
    await expect(collect(provider.run({ email: "x@example.com" }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("rejects malformed emails via inputSchema", () => {
    const provider = createGravatarProvider()
    expect(() => provider.inputSchema.parse({ email: "not-an-email" })).toThrow()
    expect(() => provider.inputSchema.parse({ email: "" })).toThrow()
    expect(() => provider.inputSchema.parse({ email: "ok@example.com" })).not.toThrow()
  })
})
