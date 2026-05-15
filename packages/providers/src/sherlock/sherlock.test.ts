import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createSherlockProvider, type FetchLike } from "@/sherlock/sherlock.js"
import { describeOsintProvider } from "@/testing/conformance.js"

const ctx = () => ({ lookupId: "test-lookup", signal: new AbortController().signal })

/**
 * Build a sidecar Response whose body emits the given SSE-encoded frames
 * one chunk at a time. The chunks parameter is opt-in for the simple
 * tests; passing a single string sends everything in one chunk.
 */
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

/** Drains an async iterable into an array — handy in tests. */
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

const conformanceProvider = createSherlockProvider({
  sidecarUrl: "http://test",
  fetch: conformanceFetch,
})

describeOsintProvider(conformanceProvider, { knownGood: { username: "anthropic" } })

describe("sherlockProvider — event translation", () => {
  it("yields Started, Partial per found, then Final with accumulated results", async () => {
    const provider = createSherlockProvider({ sidecarUrl: "http://test", fetch: conformanceFetch })
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

  it("emits one Final even with a stream split across chunks", async () => {
    const fetch = mockSidecar([
      // started + half a found event in chunk 1
      'data: {"kind":"started","username":"x"}\n\ndata: {"kind":"fou',
      'nd","site":"A","url":"https://a.test/x"}\n\n',
      'data: {"kind":"done","checked":1}\n\n',
    ])
    const provider = createSherlockProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ username: "x" }, ctx()))

    const finals = events.filter((e) => e._tag === "Final")
    expect(finals).toHaveLength(1)
    expect(finals[0]).toMatchObject({
      _tag: "Final",
      data: { found: [{ site: "A", url: "https://a.test/x" }], checked: 1 },
    })
  })

  it("uses the sidecar's `checked` count, not the partial-events tally", async () => {
    // Sidecar parses 50 sites but our regex only matched 1 found. The
    // sidecar's authoritative count should win in the Final.
    const fetch = mockSidecar([
      'data: {"kind":"started","username":"y"}\n\n',
      'data: {"kind":"found","site":"A","url":"https://a.test/y"}\n\n',
      'data: {"kind":"done","checked":50}\n\n',
    ])
    const provider = createSherlockProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ username: "y" }, ctx()))
    const final = events.find((e) => e._tag === "Final")
    expect(final).toMatchObject({ data: { checked: 50 } })
  })
})

describe("sherlockProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on 429 from the sidecar", async () => {
    const fetch = mockSidecar("", { status: 429, statusText: "Too Many Requests" })
    const provider = createSherlockProvider({ sidecarUrl: "http://test", fetch })
    await expect(collect(provider.run({ username: "x" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("throws ProviderError on a sidecar `error` event mid-stream", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","username":"z"}\n\n',
        'data: {"kind":"error","message":"sherlock exited 137"}\n\n',
      ].join(""),
    )
    const provider = createSherlockProvider({ sidecarUrl: "http://test", fetch })
    await expect(collect(provider.run({ username: "z" }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("emits Final with partial results if the stream ends without `done`", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","username":"w"}\n\n',
        'data: {"kind":"found","site":"A","url":"https://a.test/w"}\n\n',
        // No `done` — connection dropped.
      ].join(""),
    )
    const provider = createSherlockProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ username: "w" }, ctx()))
    const final = events.find((e) => e._tag === "Final")
    expect(final).toMatchObject({
      data: { found: [{ site: "A", url: "https://a.test/w" }], checked: 1 },
    })
  })

  it("rejects malformed usernames via inputSchema", () => {
    const provider = createSherlockProvider({ sidecarUrl: "http://test", fetch: mockSidecar("") })
    expect(() => provider.inputSchema.parse({ username: "" })).toThrow()
    expect(() => provider.inputSchema.parse({ username: "user with space" })).toThrow()
    expect(() => provider.inputSchema.parse({ username: "ok_user.123" })).not.toThrow()
  })
})
