import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createMaigretProvider, type FetchLike } from "@/maigret/maigret.js"
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
    'data: {"kind":"started","username":"anthropic"}\n\n',
    'data: {"kind":"found","site":"GitHub","url":"https://github.com/anthropic"}\n\n',
    'data: {"kind":"not_found","site":"Twitter"}\n\n',
    'data: {"kind":"done","checked":2}\n\n',
  ].join(""),
)

describeOsintProvider(
  createMaigretProvider({ sidecarUrl: "http://test", fetch: conformanceFetch }),
  { knownGood: { username: "anthropic" } },
)

describe("maigretProvider — event translation", () => {
  it("yields Started, Partial per found, then Final with accumulated results", async () => {
    const provider = createMaigretProvider({ sidecarUrl: "http://test", fetch: conformanceFetch })
    const events = await collect(provider.run({ username: "anthropic" }, ctx()))

    expect(events).toEqual<ProviderEvent[]>([
      { _tag: "Started" },
      {
        _tag: "Partial",
        chunk: { site: "GitHub", url: "https://github.com/anthropic" },
      },
      {
        _tag: "Final",
        data: { found: [{ site: "GitHub", url: "https://github.com/anthropic" }], checked: 2 },
      },
    ])
  })

  it("uses the sidecar's checked count, not the partial tally", async () => {
    const fetch = mockSidecar([
      'data: {"kind":"started","username":"y"}\n\n',
      'data: {"kind":"found","site":"A","url":"https://a.test/y"}\n\n',
      'data: {"kind":"done","checked":2500}\n\n',
    ])
    const provider = createMaigretProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ username: "y" }, ctx()))
    const final = events.find((e) => e._tag === "Final")
    expect(final).toMatchObject({ data: { checked: 2500 } })
  })

  it("emits Final with partial results if the stream ends without `done`", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","username":"w"}\n\n',
        'data: {"kind":"found","site":"A","url":"https://a.test/w"}\n\n',
      ].join(""),
    )
    const provider = createMaigretProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ username: "w" }, ctx()))
    const final = events.find((e) => e._tag === "Final")
    expect(final).toMatchObject({
      data: { found: [{ site: "A", url: "https://a.test/w" }], checked: 1 },
    })
  })
})

describe("maigretProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on 429", async () => {
    const fetch = mockSidecar("", { status: 429, statusText: "Too Many Requests" })
    const provider = createMaigretProvider({ sidecarUrl: "http://test", fetch })
    await expect(collect(provider.run({ username: "x" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("throws ProviderError on a sidecar `error` event mid-stream", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","username":"z"}\n\n',
        'data: {"kind":"error","message":"maigret exited 137"}\n\n',
      ].join(""),
    )
    const provider = createMaigretProvider({ sidecarUrl: "http://test", fetch })
    await expect(collect(provider.run({ username: "z" }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("rejects malformed usernames via inputSchema", () => {
    const provider = createMaigretProvider({ sidecarUrl: "http://test", fetch: mockSidecar("") })
    expect(() => provider.inputSchema.parse({ username: "" })).toThrow()
    expect(() => provider.inputSchema.parse({ username: "user with space" })).toThrow()
    expect(() => provider.inputSchema.parse({ username: "ok_user.123" })).not.toThrow()
  })
})
