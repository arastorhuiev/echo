import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createSocialscanProvider, type FetchLike } from "@/socialscan/socialscan.js"
import type { SocialscanOutput } from "@/socialscan/socialscan.types.js"
import { describeOsintProvider } from "@/testing/conformance.js"

const ctx = () => ({ lookupId: "test-lookup", signal: new AbortController().signal })

function mockSidecar(
  frames: string | readonly string[],
  init: { status?: number; statusText?: string } = {},
): FetchLike {
  return async () => {
    const chunks = typeof frames === "string" ? [frames] : frames
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    return {
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      statusText: init.statusText ?? "OK",
      text: async () => "",
      body,
    }
  }
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of it) out.push(v)
  return out
}

const conformanceFetch = mockSidecar(
  [
    'data: {"kind":"started","query":"jane"}\n\n',
    'data: {"kind":"result","query":"jane","platform":"GitHub","available":false,"valid":true,"success":true}\n\n',
    'data: {"kind":"result","query":"jane","platform":"Twitter","available":true,"valid":true,"success":true}\n\n',
    'data: {"kind":"done","checked":2}\n\n',
  ].join(""),
)

describeOsintProvider(
  createSocialscanProvider({ sidecarUrl: "http://test", fetch: conformanceFetch }),
  { knownGood: { queries: ["jane"] } },
)

describe("socialscanProvider — event translation", () => {
  it("yields Started, Partial per platform-result, then Final with all entries", async () => {
    const provider = createSocialscanProvider({
      sidecarUrl: "http://test",
      fetch: conformanceFetch,
    })
    const events = await collect(provider.run({ queries: ["jane"] }, ctx()))

    expect(events[0]).toEqual({ _tag: "Started" })

    const partials = events.filter((e) => e._tag === "Partial")
    expect(partials).toHaveLength(2)
    expect(partials[0]).toMatchObject({
      chunk: { query: "jane", platform: "GitHub", available: false, valid: true },
    })

    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<SocialscanOutput>,
      { _tag: "Final" }
    >
    expect(final.data.results).toHaveLength(2)
    expect(final.data.checked).toBe(2)
  })

  it("normalises missing per-result booleans to null", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","query":"x"}\n\n',
        'data: {"kind":"result","query":"x","platform":"PartialPlatform","available":false}\n\n',
        'data: {"kind":"done","checked":1}\n\n',
      ].join(""),
    )
    const provider = createSocialscanProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ queries: ["x"] }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<SocialscanOutput>,
      { _tag: "Final" }
    >
    expect(final.data.results[0]).toMatchObject({
      platform: "PartialPlatform",
      available: false,
      valid: null,
      success: null,
    })
  })

  it("emits Final with partial results if the stream ends without `done`", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","query":"y"}\n\n',
        'data: {"kind":"result","query":"y","platform":"A","available":false,"valid":true,"success":true}\n\n',
      ].join(""),
    )
    const provider = createSocialscanProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ queries: ["y"] }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<SocialscanOutput>,
      { _tag: "Final" }
    >
    expect(final.data.results).toHaveLength(1)
    expect(final.data.checked).toBe(1)
  })
})

describe("socialscanProvider — error paths", () => {
  it("throws ProviderError on a sidecar `error` event", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","query":"z"}\n\n',
        'data: {"kind":"error","message":"socialscan crashed"}\n\n',
      ].join(""),
    )
    const provider = createSocialscanProvider({ sidecarUrl: "http://test", fetch })
    await expect(collect(provider.run({ queries: ["z"] }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("throws ProviderError(RateLimited) on 429", async () => {
    const fetch = mockSidecar("", { status: 429, statusText: "Too Many Requests" })
    const provider = createSocialscanProvider({ sidecarUrl: "http://test", fetch })
    await expect(collect(provider.run({ queries: ["x"] }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("rejects empty queries array via inputSchema", () => {
    const provider = createSocialscanProvider({ sidecarUrl: "http://test", fetch: mockSidecar("") })
    expect(() => provider.inputSchema.parse({ queries: [] })).toThrow()
    expect(() => provider.inputSchema.parse({ queries: ["ok"] })).not.toThrow()
  })

  it("caps queries at 10 entries", () => {
    const provider = createSocialscanProvider({ sidecarUrl: "http://test", fetch: mockSidecar("") })
    expect(() =>
      provider.inputSchema.parse({
        queries: Array.from({ length: 11 }, (_, i) => `q${i}`),
      }),
    ).toThrow()
  })
})
