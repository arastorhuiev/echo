import type { Redis } from "ioredis"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { type OsintProvider, ProviderError, type ProviderEvent } from "@/core/provider.js"
import { withSingleFlight } from "@/core/wrappers/with-single-flight.js"

/** In-memory Redis with just enough pub/sub for the single-flight wrapper. */
interface Bus {
  readonly store: Map<string, string>
  readonly channels: Map<string, Set<FakeRedis>>
}

class FakeRedis {
  readonly messageHandlers: Array<(channel: string, message: string) => void> = []
  private readonly subscribed = new Set<string>()
  constructor(private readonly bus: Bus) {}

  async set(key: string, value: string, ...args: unknown[]): Promise<"OK" | null> {
    if (args.includes("NX") && this.bus.store.has(key)) return null
    this.bus.store.set(key, String(value))
    return "OK"
  }
  async get(key: string) {
    return this.bus.store.get(key) ?? null
  }
  async del(key: string) {
    return this.bus.store.delete(key) ? 1 : 0
  }
  async publish(channel: string, message: string) {
    const subs = this.bus.channels.get(channel)
    if (!subs) return 0
    for (const conn of subs) {
      for (const handler of conn.messageHandlers) handler(channel, message)
    }
    return subs.size
  }
  duplicate() {
    return new FakeRedis(this.bus)
  }
  async subscribe(channel: string) {
    this.subscribed.add(channel)
    let set = this.bus.channels.get(channel)
    if (!set) {
      set = new Set()
      this.bus.channels.set(channel, set)
    }
    set.add(this)
    return 1
  }
  on(event: string, cb: (channel: string, message: string) => void) {
    if (event === "message") this.messageHandlers.push(cb)
    return this
  }
  async unsubscribe() {
    for (const ch of this.subscribed) this.bus.channels.get(ch)?.delete(this)
    this.subscribed.clear()
    return 0
  }
  disconnect() {
    this.messageHandlers.length = 0
  }
}

const redisFake = () => new FakeRedis({ store: new Map(), channels: new Map() }) as unknown as Redis

function provider(
  behaviour: { fail?: boolean; onRun?: () => void } = {},
): OsintProvider<{ q: string }, { v: number }> {
  return {
    id: "p",
    category: "meta",
    inputSchema: z.object({ q: z.string() }),
    outputSchema: z.object({ v: z.number() }),
    defaults: {
      timeoutMs: 1000,
      maxConcurrent: 1,
      cacheTtlSec: 0,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    },
    async *run() {
      behaviour.onRun?.()
      yield { _tag: "Started" }
      await Promise.resolve() // hand control to a concurrent follower
      if (behaviour.fail) throw new ProviderError("p", "Network", "boom")
      yield { _tag: "Final", data: { v: 42 } }
    },
  }
}

async function drain(p: OsintProvider<{ q: string }, { v: number }>, q = "same") {
  const events: ProviderEvent<{ v: number }>[] = []
  for await (const e of p.run({ q }, { lookupId: "l", signal: new AbortController().signal })) {
    events.push(e)
  }
  return events
}

const finalData = (events: ProviderEvent<{ v: number }>[]) =>
  events.find((e) => e._tag === "Final")?.data

describe("withSingleFlight", () => {
  it("collapses concurrent identical queries to one upstream call", async () => {
    let calls = 0
    const wrapped = withSingleFlight(provider({ onRun: () => calls++ }), redisFake(), {
      waitTimeoutMs: 1000,
    })

    const [a, b] = await Promise.all([drain(wrapped), drain(wrapped)])

    expect(calls).toBe(1)
    expect(finalData(a)).toEqual({ v: 42 })
    expect(finalData(b)).toEqual({ v: 42 })
    // Exactly one of the two saw the real (possibly multi-event) stream;
    // the follower got a synthetic Started + Final only.
    const follower = a.length === 2 ? a : b
    expect(follower.map((e) => e._tag)).toEqual(["Started", "Final"])
  })

  it("does not collapse distinct queries", async () => {
    let calls = 0
    const wrapped = withSingleFlight(provider({ onRun: () => calls++ }), redisFake(), {
      waitTimeoutMs: 1000,
    })

    await Promise.all([drain(wrapped, "alice"), drain(wrapped, "bob")])
    expect(calls).toBe(2)
  })

  it("a follower runs itself when the leader fails", async () => {
    let calls = 0
    const wrapped = withSingleFlight(provider({ fail: true, onRun: () => calls++ }), redisFake(), {
      waitTimeoutMs: 1000,
    })

    const results = await Promise.allSettled([drain(wrapped), drain(wrapped)])
    expect(results.every((r) => r.status === "rejected")).toBe(true)
    expect(calls).toBe(2) // leader failed → follower fell through and ran too
  })
})
