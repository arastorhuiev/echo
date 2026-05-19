import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createHibpProvider, type FetchLike } from "@/hibp/hibp.js"
import type { HibpOutput } from "@/hibp/hibp.types.js"
import { describeOsintProvider } from "@/testing/conformance.js"

const ctx = () => ({ lookupId: "test-lookup", signal: new AbortController().signal })

/**
 * Build a fake HIBP range response containing the given suffix→count
 * pairs plus a handful of decoy lines. Output mirrors HIBP's real
 * CRLF-separated text format.
 */
function rangeBody(entries: ReadonlyArray<readonly [string, number]>): string {
  const decoys = ["0000000000000000000000000000000000A:1", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:99"]
  return [...entries.map(([s, c]) => `${s.toUpperCase()}:${c}`), ...decoys].join("\r\n")
}

function mockFetch(opts: { status?: number; body?: string; statusText?: string }): FetchLike {
  return async () => ({
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    text: async () => opts.body ?? "",
  })
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of it) out.push(v)
  return out
}

function sha1Pair(plain: string): { prefix: string; suffix: string } {
  const hex = createHash("sha1").update(plain).digest("hex").toUpperCase()
  return { prefix: hex.slice(0, 5), suffix: hex.slice(5) }
}

const helloPair = sha1Pair("hello")
const conformanceProvider = createHibpProvider({
  fetch: mockFetch({ body: rangeBody([[helloPair.suffix, 1234]]) }),
})

describeOsintProvider(conformanceProvider, { knownGood: { password: "hello" } })

describe("hibpProvider — pwned password path", () => {
  it("reports pwned: true and the breach count for a matching suffix", async () => {
    const { suffix } = sha1Pair("hello")
    const provider = createHibpProvider({
      fetch: mockFetch({ body: rangeBody([[suffix, 1234]]) }),
    })
    const events = await collect(provider.run({ password: "hello" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<HibpOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual({ pwned: true, breach_count: 1234 })
  })

  it("uses only the 5-char prefix for the outbound URL — privacy guarantee", async () => {
    const { prefix, suffix } = sha1Pair("secret-pw")
    let calledUrl: string | undefined
    const fetch: FetchLike = async (url) => {
      calledUrl = url
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => rangeBody([[suffix, 7]]),
      }
    }
    const provider = createHibpProvider({ fetch, baseUrl: "https://api.test" })
    await collect(provider.run({ password: "secret-pw" }, ctx()))
    expect(calledUrl).toBe(`https://api.test/range/${prefix}`)
    // Critical privacy invariant: the full hash never appears in the URL.
    expect(calledUrl).not.toContain(suffix)
  })
})

describe("hibpProvider — clean password path", () => {
  it("reports pwned: false when our suffix isn't in the range", async () => {
    const provider = createHibpProvider({
      fetch: mockFetch({
        // The mock returns decoys only — no match for our actual suffix.
        body: [
          "1111111111111111111111111111111111A:1",
          "2222222222222222222222222222222222B:2",
        ].join("\r\n"),
      }),
    })
    const events = await collect(provider.run({ password: "clean-password" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<HibpOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual({ pwned: false, breach_count: 0 })
  })

  it("tolerates both LF and CRLF line separators", async () => {
    const { suffix } = sha1Pair("crlf-test")
    const provider = createHibpProvider({
      fetch: mockFetch({
        body: `${suffix.toUpperCase()}:5\nDECOYDECOYDECOYDECOYDECOYDECOYDECOY:1`,
      }),
    })
    const events = await collect(provider.run({ password: "crlf-test" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<HibpOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual({ pwned: true, breach_count: 5 })
  })
})

describe("hibpProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on 429", async () => {
    const provider = createHibpProvider({
      fetch: mockFetch({ status: 429, statusText: "Too Many Requests" }),
    })
    await expect(collect(provider.run({ password: "x" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("throws ProviderError(Network) on 500", async () => {
    const provider = createHibpProvider({ fetch: mockFetch({ status: 500 }) })
    await expect(collect(provider.run({ password: "x" }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("rejects empty password via inputSchema", () => {
    const provider = createHibpProvider()
    expect(() => provider.inputSchema.parse({ password: "" })).toThrow()
    expect(() => provider.inputSchema.parse({ password: "ok" })).not.toThrow()
  })
})
