import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createIgnorantProvider, type FetchLike } from "@/ignorant/ignorant.js"
import type { IgnorantOutput } from "@/ignorant/ignorant.types.js"
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
    'data: {"kind":"started","phone":"6444637111"}\n\n',
    'data: {"kind":"result","platform":"instagram","domain":"instagram.com","method":"other","exists":true,"rate_limit":false}\n\n',
    'data: {"kind":"result","platform":"snapchat","domain":"snapchat.com","exists":false}\n\n',
    'data: {"kind":"done","checked":2}\n\n',
  ].join(""),
)

describeOsintProvider(
  createIgnorantProvider({ sidecarUrl: "http://test", fetch: conformanceFetch }),
  { knownGood: { country_code: "33", phone: "644637111" } },
)

describe("ignorantProvider — event translation", () => {
  it("yields Started, Partial per platform, then Final with accumulated results", async () => {
    const provider = createIgnorantProvider({ sidecarUrl: "http://test", fetch: conformanceFetch })
    const events = await collect(provider.run({ country_code: "33", phone: "644637111" }, ctx()))

    expect(events[0]).toEqual({ _tag: "Started" })

    const partials = events.filter((e) => e._tag === "Partial")
    expect(partials).toHaveLength(2)
    expect(partials[0]).toMatchObject({
      chunk: { platform: "instagram", exists: true },
    })

    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<IgnorantOutput>,
      { _tag: "Final" }
    >
    expect(final.data.results).toHaveLength(2)
    expect(final.data.checked).toBe(2)
  })

  it("normalises missing per-result booleans to null", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","phone":"1"}\n\n',
        'data: {"kind":"result","platform":"amazon"}\n\n',
        'data: {"kind":"done","checked":1}\n\n',
      ].join(""),
    )
    const provider = createIgnorantProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ country_code: "1", phone: "5555555555" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<IgnorantOutput>,
      { _tag: "Final" }
    >
    expect(final.data.results[0]).toMatchObject({
      platform: "amazon",
      exists: null,
      rate_limit: null,
    })
  })

  it("emits Final with partial results if the stream ends without `done`", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","phone":"1"}\n\n',
        'data: {"kind":"result","platform":"instagram","exists":true}\n\n',
      ].join(""),
    )
    const provider = createIgnorantProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ country_code: "1", phone: "5555555555" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<IgnorantOutput>,
      { _tag: "Final" }
    >
    expect(final.data.results).toHaveLength(1)
    expect(final.data.checked).toBe(1)
  })
})

describe("ignorantProvider — error paths", () => {
  it("throws ProviderError on sidecar `error` event mid-stream", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","phone":"1"}\n\n',
        'data: {"kind":"error","message":"ignorant exited 137"}\n\n',
      ].join(""),
    )
    const provider = createIgnorantProvider({ sidecarUrl: "http://test", fetch })
    await expect(
      collect(provider.run({ country_code: "1", phone: "5555555555" }, ctx())),
    ).rejects.toBeInstanceOf(ProviderError)
  })

  it("throws ProviderError(RateLimited) on 429", async () => {
    const fetch = mockSidecar("", { status: 429, statusText: "Too Many Requests" })
    const provider = createIgnorantProvider({ sidecarUrl: "http://test", fetch })
    await expect(
      collect(provider.run({ country_code: "1", phone: "5555555555" }, ctx())),
    ).rejects.toMatchObject({ name: "ProviderError", kind: "RateLimited" })
  })

  it("rejects malformed inputs via inputSchema (no +, digits only)", () => {
    const provider = createIgnorantProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar(""),
    })
    expect(() => provider.inputSchema.parse({ country_code: "+1", phone: "5555555555" })).toThrow()
    expect(() => provider.inputSchema.parse({ country_code: "1", phone: "abc" })).toThrow()
    expect(() =>
      provider.inputSchema.parse({ country_code: "1", phone: "5555555555" }),
    ).not.toThrow()
  })
})
