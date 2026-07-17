import { describe, expect, it } from "vitest"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { createHudsonRockProvider, type FetchLike } from "@/hudsonrock/hudsonrock.js"
import type { HudsonRockOutput } from "@/hudsonrock/hudsonrock.types.js"
import { describeOsintProvider } from "@/testing/conformance.js"

function fakeFetch(response: {
  ok?: boolean
  status?: number
  body?: unknown
  onUrl?: (url: string) => void
}): FetchLike {
  return async (url) => {
    response.onUrl?.(url)
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      statusText: "OK",
      json: async () => response.body ?? {},
      text: async () => JSON.stringify(response.body ?? {}),
    }
  }
}

async function drain(
  provider: ReturnType<typeof createHudsonRockProvider>,
  query: Parameters<ReturnType<typeof createHudsonRockProvider>["run"]>[0],
): Promise<ProviderEvent<HudsonRockOutput>[]> {
  const events: ProviderEvent<HudsonRockOutput>[] = []
  for await (const e of provider.run(query, {
    lookupId: "t",
    signal: new AbortController().signal,
  })) {
    events.push(e)
  }
  return events
}

const finalData = (events: ProviderEvent<HudsonRockOutput>[]) =>
  events.find((e) => e._tag === "Final")?.data

describeOsintProvider(
  createHudsonRockProvider({ fetch: fakeFetch({ body: { message: "ok", stealers: [] } }) }),
  { knownGood: { email: "test@example.com" } },
)

describe("createHudsonRockProvider", () => {
  it("reports found + stealer count when the email is compromised", async () => {
    const provider = createHudsonRockProvider({
      fetch: fakeFetch({ body: { message: "compromised", stealers: [{ id: 1 }, { id: 2 }] } }),
    })
    const data = finalData(await drain(provider, { email: "victim@example.com" }))
    expect(data).toEqual({
      found: true,
      message: "compromised",
      stealerCount: 2,
      stealers: [{ id: 1 }, { id: 2 }],
    })
  })

  it("reports not-found when there are no stealers", async () => {
    const provider = createHudsonRockProvider({
      fetch: fakeFetch({ body: { message: "not associated", stealers: [] } }),
    })
    const data = finalData(await drain(provider, { username: "cleanuser" }))
    expect(data?.found).toBe(false)
    expect(data?.stealerCount).toBe(0)
  })

  it("routes to the email vs username endpoint by input shape", async () => {
    const urls: string[] = []
    const provider = createHudsonRockProvider({
      fetch: fakeFetch({ body: { stealers: [] }, onUrl: (u) => urls.push(u) }),
    })
    await drain(provider, { email: "a@b.com" })
    await drain(provider, { username: "bob" })
    expect(urls[0]).toContain("/search-by-email?email=a%40b.com")
    expect(urls[1]).toContain("/search-by-username?username=bob")
  })

  it("throws a ProviderError on a non-OK response", async () => {
    const provider = createHudsonRockProvider({
      fetch: fakeFetch({ ok: false, status: 429, body: {} }),
    })
    await expect(drain(provider, { email: "a@b.com" })).rejects.toBeInstanceOf(ProviderError)
  })
})
