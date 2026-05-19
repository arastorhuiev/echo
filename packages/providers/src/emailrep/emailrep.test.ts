import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createEmailrepProvider, type FetchLike } from "@/emailrep/emailrep.js"
import type { EmailrepOutput } from "@/emailrep/emailrep.types.js"
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

const richResponse = {
  email: "jane@example.com",
  reputation: "high",
  suspicious: false,
  references: 12,
  details: {
    blacklisted: false,
    malicious_activity: false,
    deliverable: true,
    first_seen: "2018-03",
    last_seen: "2026-05",
    domain_exists: true,
    domain_reputation: "high",
    profiles: ["github", "linkedin", "twitter"],
    data_breach: false,
    // Field we intentionally drop:
    days_since_first_seen: 2911,
  },
}

describeOsintProvider(createEmailrepProvider({ fetch: mockFetch({ body: richResponse }) }), {
  knownGood: { email: "jane@example.com" },
})

describe("emailrepProvider — found path", () => {
  it("normalises a rich response, dropping unknown detail fields", async () => {
    const provider = createEmailrepProvider({ fetch: mockFetch({ body: richResponse }) })
    const events = await collect(provider.run({ email: "jane@example.com" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<EmailrepOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toMatchObject({
      email: "jane@example.com",
      reputation: "high",
      suspicious: false,
      references: 12,
      details: {
        deliverable: true,
        first_seen: "2018-03",
        domain_reputation: "high",
        profiles: ["github", "linkedin", "twitter"],
      },
    })
    expect(final.data.details).not.toHaveProperty("days_since_first_seen")
  })

  it("treats reputation:none as a normal Final (not a failure)", async () => {
    const provider = createEmailrepProvider({
      fetch: mockFetch({
        body: {
          email: "ghost@example.com",
          reputation: "none",
          suspicious: false,
          references: 0,
        },
      }),
    })
    const events = await collect(provider.run({ email: "ghost@example.com" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<EmailrepOutput>,
      { _tag: "Final" }
    >
    expect(final.data.reputation).toBe("none")
    expect(final.data.references).toBe(0)
  })

  it("lower-cases the email in the outbound URL", async () => {
    let calledUrl: string | undefined
    const fetch: FetchLike = async (url) => {
      calledUrl = url
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => richResponse,
        text: async () => "",
      }
    }
    const provider = createEmailrepProvider({ fetch, baseUrl: "https://api.test" })
    await collect(provider.run({ email: "  Jane@Example.COM " }, ctx()))
    expect(calledUrl).toBe(`https://api.test/${encodeURIComponent("jane@example.com")}`)
  })

  it("sends the Key header when apiKey is provided", async () => {
    let sentHeaders: Record<string, string> | undefined
    const fetch: FetchLike = async (_url, init) => {
      sentHeaders = init?.headers
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => richResponse,
        text: async () => "",
      }
    }
    const provider = createEmailrepProvider({ fetch, apiKey: "test-key-123" })
    await collect(provider.run({ email: "x@example.com" }, ctx()))
    expect(sentHeaders?.Key).toBe("test-key-123")
  })

  it("omits the Key header when apiKey is empty", async () => {
    let sentHeaders: Record<string, string> | undefined
    const fetch: FetchLike = async (_url, init) => {
      sentHeaders = init?.headers
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => richResponse,
        text: async () => "",
      }
    }
    const provider = createEmailrepProvider({ fetch, apiKey: "" })
    await collect(provider.run({ email: "x@example.com" }, ctx()))
    expect(sentHeaders?.Key).toBeUndefined()
  })
})

describe("emailrepProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on 429", async () => {
    const provider = createEmailrepProvider({
      fetch: mockFetch({ status: 429, statusText: "Too Many Requests" }),
    })
    await expect(collect(provider.run({ email: "x@example.com" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("throws ProviderError(Network) on 502", async () => {
    const provider = createEmailrepProvider({ fetch: mockFetch({ status: 502 }) })
    await expect(collect(provider.run({ email: "x@example.com" }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("falls back to safe defaults for an empty-ish body", async () => {
    const provider = createEmailrepProvider({ fetch: mockFetch({ body: {} }) })
    const events = await collect(provider.run({ email: "x@example.com" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<EmailrepOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual({
      email: "x@example.com",
      reputation: "none",
      suspicious: false,
      references: 0,
    })
  })

  it("rejects malformed email via inputSchema", () => {
    const provider = createEmailrepProvider()
    expect(() => provider.inputSchema.parse({ email: "not-an-email" })).toThrow()
    expect(() => provider.inputSchema.parse({ email: "ok@example.com" })).not.toThrow()
  })
})
