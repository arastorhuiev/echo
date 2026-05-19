import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createMailcatProvider, type FetchLike } from "@/mailcat/mailcat.js"
import type { MailcatOutput } from "@/mailcat/mailcat.types.js"
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
    'data: {"kind":"started","username":"jane"}\n\n',
    'data: {"kind":"result","email":"jane@gmail.com","exists":true}\n\n',
    'data: {"kind":"result","email":"jane@protonmail.com","exists":false}\n\n',
    'data: {"kind":"done","checked":2}\n\n',
  ].join(""),
)

describeOsintProvider(
  createMailcatProvider({ sidecarUrl: "http://test", fetch: conformanceFetch }),
  { knownGood: { username: "jane" } },
)

describe("mailcatProvider — event translation", () => {
  it("yields Partial per existing email then Final with results + found", async () => {
    const provider = createMailcatProvider({ sidecarUrl: "http://test", fetch: conformanceFetch })
    const events = await collect(provider.run({ username: "jane" }, ctx()))

    expect(events[0]).toEqual({ _tag: "Started" })

    const partials = events.filter((e) => e._tag === "Partial")
    expect(partials).toHaveLength(1)
    expect(partials[0]).toEqual({
      _tag: "Partial",
      chunk: { email: "jane@gmail.com", exists: true },
    })

    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<MailcatOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toEqual({
      results: [
        { email: "jane@gmail.com", exists: true },
        { email: "jane@protonmail.com", exists: false },
      ],
      found: ["jane@gmail.com"],
      checked: 2,
      error: null,
    })
  })

  it("does NOT yield Partial for non-existing emails — only Final lists them in results", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","username":"x"}\n\n',
        'data: {"kind":"result","email":"x@a.com","exists":false}\n\n',
        'data: {"kind":"result","email":"x@b.com","exists":false}\n\n',
        'data: {"kind":"done","checked":2}\n\n',
      ].join(""),
    )
    const provider = createMailcatProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ username: "x" }, ctx()))
    expect(events.filter((e) => e._tag === "Partial")).toHaveLength(0)
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<MailcatOutput>,
      { _tag: "Final" }
    >
    expect(final.data.found).toEqual([])
    expect(final.data.results).toHaveLength(2)
  })

  it("emits Final with partial results if the stream ends without `done`", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"started","username":"y"}\n\n',
        'data: {"kind":"result","email":"y@gmail.com","exists":true}\n\n',
      ].join(""),
    )
    const provider = createMailcatProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ username: "y" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<MailcatOutput>,
      { _tag: "Final" }
    >
    expect(final.data.found).toEqual(["y@gmail.com"])
    expect(final.data.checked).toBe(1)
  })
})

describe("mailcatProvider — env-conditional path", () => {
  it("surfaces 'not configured' as a Final with error set (not a throw)", async () => {
    const fetch = mockSidecar(
      [
        'data: {"kind":"error","message":"mailcat not configured. Set MAILCAT_INSTALL_PATH..."}\n\n',
      ].join(""),
    )
    const provider = createMailcatProvider({ sidecarUrl: "http://test", fetch })
    const events = await collect(provider.run({ username: "z" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<MailcatOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toMatchObject({
      results: [],
      found: [],
      checked: 0,
      error: expect.stringContaining("not configured") as unknown as string,
    })
  })
})

describe("mailcatProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on sidecar 429", async () => {
    const fetch = mockSidecar("", { status: 429 })
    const provider = createMailcatProvider({ sidecarUrl: "http://test", fetch })
    await expect(collect(provider.run({ username: "x" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("rejects malformed usernames via inputSchema", () => {
    const provider = createMailcatProvider({ sidecarUrl: "http://test", fetch: mockSidecar("") })
    expect(() => provider.inputSchema.parse({ username: "" })).toThrow()
    expect(() => provider.inputSchema.parse({ username: "user with space" })).toThrow()
    expect(() => provider.inputSchema.parse({ username: "ok_user.123" })).not.toThrow()
  })
})
