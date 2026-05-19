import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import {
  createTelegramResolveProvider,
  type FetchLike,
} from "@/telegram-resolve/telegram-resolve.js"
import type { TelegramResolveOutput } from "@/telegram-resolve/telegram-resolve.types.js"
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

const foundResponse: TelegramResolveOutput = {
  configured: true,
  found_on_telegram: true,
  user_id: 123456789,
  username: "johnsmith",
  first_name: "John",
  last_name: "S.",
  about: "Plumber, London",
  status: "UserStatusOnline",
  is_premium: false,
  is_bot: false,
  is_verified: false,
  is_scam: false,
  is_fake: false,
  error: null,
}

describeOsintProvider(
  createTelegramResolveProvider({
    sidecarUrl: "http://test",
    fetch: mockSidecar({ body: foundResponse }),
  }),
  { knownGood: { phone: "+442079460958" } },
)

describe("telegramResolveProvider — found path", () => {
  it("yields Started then Final with the profile when Telegram returns a user", async () => {
    const provider = createTelegramResolveProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: foundResponse }),
    })
    const events = await collect(provider.run({ phone: "+442079460958" }, ctx()))
    expect(events[0]).toEqual({ _tag: "Started" })
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<TelegramResolveOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toMatchObject({
      configured: true,
      found_on_telegram: true,
      username: "johnsmith",
    })
  })
})

describe("telegramResolveProvider — env-conditional path", () => {
  it("surfaces configured=false + error as a normal Final (no throw)", async () => {
    const provider = createTelegramResolveProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({
        body: {
          configured: false,
          found_on_telegram: false,
          error: "Telegram lookup not configured. ...",
        },
      }),
    })
    const events = await collect(provider.run({ phone: "+1" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<TelegramResolveOutput>,
      { _tag: "Final" }
    >
    expect(final.data.configured).toBe(false)
    expect(final.data.error).toMatch(/not configured/i)
    expect(final.data.found_on_telegram).toBe(false)
  })

  it("surfaces configured=true + Telethon error as a normal Final", async () => {
    const provider = createTelegramResolveProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({
        body: {
          configured: true,
          found_on_telegram: false,
          error: "telethon error: FLOOD_WAIT",
        },
      }),
    })
    const events = await collect(provider.run({ phone: "+1" }, ctx()))
    const final = events.find((e) => e._tag === "Final") as Extract<
      ProviderEvent<TelegramResolveOutput>,
      { _tag: "Final" }
    >
    expect(final.data).toMatchObject({
      configured: true,
      found_on_telegram: false,
      error: expect.stringContaining("FLOOD_WAIT") as unknown as string,
    })
  })
})

describe("telegramResolveProvider — error paths", () => {
  it("throws ProviderError(RateLimited) on sidecar 429", async () => {
    const provider = createTelegramResolveProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ status: 429 }),
    })
    await expect(collect(provider.run({ phone: "+1" }, ctx()))).rejects.toMatchObject({
      name: "ProviderError",
      kind: "RateLimited",
    })
  })

  it("throws ProviderError(Parse) when sidecar payload is malformed", async () => {
    const provider = createTelegramResolveProvider({
      sidecarUrl: "http://test",
      fetch: mockSidecar({ body: { configured: "not-a-bool" } }),
    })
    await expect(collect(provider.run({ phone: "+1" }, ctx()))).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it("rejects empty phone via inputSchema", () => {
    const provider = createTelegramResolveProvider({ sidecarUrl: "http://test" })
    expect(() => provider.inputSchema.parse({ phone: "" })).toThrow()
    expect(() => provider.inputSchema.parse({ phone: "+442079460958" })).not.toThrow()
  })
})
