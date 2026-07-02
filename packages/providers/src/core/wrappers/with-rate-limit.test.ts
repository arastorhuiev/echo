import type { Redis } from "ioredis"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { OsintProvider } from "@/core/provider.js"
import { withRateLimit } from "@/core/wrappers/with-rate-limit.js"

class FakeRedis {
  readonly store = new Map<string, number>()
  async incr(k: string) {
    const n = (this.store.get(k) ?? 0) + 1
    this.store.set(k, n)
    return n
  }
  async pexpire() {
    return 1
  }
}
const redisFake = () => new FakeRedis() as unknown as Redis

function provider(ratePerSec?: number): OsintProvider<{ q: string }, { ok: true }> {
  return {
    id: "p",
    category: "meta",
    inputSchema: z.object({ q: z.string() }),
    outputSchema: z.object({ ok: z.literal(true) }),
    defaults: {
      timeoutMs: 1000,
      maxConcurrent: 1,
      cacheTtlSec: 0,
      ratePerSec,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    },
    async *run() {
      yield { _tag: "Started" }
      yield { _tag: "Final", data: { ok: true } }
    },
  }
}

function counted(base: OsintProvider<{ q: string }, { ok: true }>, counter: { n: number }) {
  return {
    ...base,
    async *run(query: { q: string }, ctx: { lookupId: string; signal: AbortSignal }) {
      counter.n++
      yield* base.run(query, ctx)
    },
  } as OsintProvider<{ q: string }, { ok: true }>
}

async function drain(p: OsintProvider<{ q: string }, { ok: true }>) {
  for await (const _e of p.run(
    { q: "x" },
    { lookupId: "l", signal: new AbortController().signal },
  )) {
    // discard
  }
}

describe("withRateLimit", () => {
  it("lets ratePerSec runs through a window, then defers the next to the following window", async () => {
    const redis = redisFake()
    let clock = 5_000 // window = second 5, aligned to the boundary
    const sleep = vi.fn(async (ms: number) => {
      clock += ms
    })
    const counter = { n: 0 }
    const wrapped = withRateLimit(counted(provider(2), counter), redis, { now: () => clock, sleep })

    await drain(wrapped)
    await drain(wrapped)
    expect(sleep).not.toHaveBeenCalled() // 2 fit in the window

    await drain(wrapped) // 3rd overflows → waits once, proceeds in the next window
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(1_000, expect.anything())
    expect(counter.n).toBe(3)
  })

  it("defaults to 10/s when ratePerSec is unset", async () => {
    const redis = redisFake()
    let clock = 0
    const sleep = vi.fn(async (ms: number) => {
      clock += ms
    })
    const wrapped = withRateLimit(provider(), redis, { now: () => clock, sleep })

    for (let i = 0; i < 10; i++) await drain(wrapped)
    expect(sleep).not.toHaveBeenCalled()

    await drain(wrapped) // 11th overflows the window → waits once, runs next window
    expect(sleep).toHaveBeenCalledTimes(1)
  })
})
