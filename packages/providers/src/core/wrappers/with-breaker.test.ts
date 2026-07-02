import type { Redis } from "ioredis"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { type OsintProvider, ProviderError } from "@/core/provider.js"
import { withBreaker } from "@/core/wrappers/with-breaker.js"

class FakeRedis {
  readonly store = new Map<string, string>()
  async get(k: string) {
    return this.store.get(k) ?? null
  }
  async set(k: string, v: string | number) {
    this.store.set(k, String(v))
    return "OK" as const
  }
  async del(k: string) {
    return this.store.delete(k) ? 1 : 0
  }
  async incr(k: string) {
    const n = Number(this.store.get(k) ?? 0) + 1
    this.store.set(k, String(n))
    return n
  }
}
const redisFake = () => new FakeRedis() as unknown as Redis

function provider(opts: { fail?: boolean } = {}): OsintProvider<{ q: string }, { ok: true }> {
  return {
    id: "p",
    category: "meta",
    inputSchema: z.object({ q: z.string() }),
    outputSchema: z.object({ ok: z.literal(true) }),
    defaults: {
      timeoutMs: 1000,
      maxConcurrent: 1,
      cacheTtlSec: 0,
      breaker: { failureThreshold: 3, resetMs: 30_000 },
    },
    async *run() {
      yield { _tag: "Started" }
      if (opts.fail) throw new ProviderError("p", "Network", "boom")
      yield { _tag: "Final", data: { ok: true } }
    },
  }
}

/** Wraps a provider so we can count how many times upstream `run()` was entered. */
function counted(
  base: OsintProvider<{ q: string }, { ok: true }>,
  counter: { n: number },
): OsintProvider<{ q: string }, { ok: true }> {
  return {
    ...base,
    async *run(query, ctx) {
      counter.n++
      yield* base.run(query, ctx)
    },
  }
}

async function drain(p: OsintProvider<{ q: string }, { ok: true }>, signal?: AbortSignal) {
  const out: unknown[] = []
  for await (const e of p.run(
    { q: "x" },
    { lookupId: "l", signal: signal ?? new AbortController().signal },
  )) {
    out.push(e)
  }
  return out
}

describe("withBreaker", () => {
  it("opens after failureThreshold consecutive failures and persists the transition", async () => {
    const redis = redisFake()
    const persist = vi.fn().mockResolvedValue(undefined)
    const wrapped = withBreaker(provider({ fail: true }), { redis, persist, now: () => 1000 })

    for (let i = 0; i < 3; i++) {
      await expect(drain(wrapped)).rejects.toBeInstanceOf(ProviderError)
    }

    expect(await redis.get("breaker:p:state")).toBe("open")
    expect(persist).toHaveBeenLastCalledWith("p", "open", "failure")
  })

  it("short-circuits with CircuitOpen while open — no upstream call", async () => {
    const redis = redisFake()
    const persist = vi.fn().mockResolvedValue(undefined)
    const failing = withBreaker(provider({ fail: true }), { redis, persist, now: () => 1000 })
    for (let i = 0; i < 3; i++) await expect(drain(failing)).rejects.toBeInstanceOf(ProviderError)

    const counter = { n: 0 }
    const succeeding = withBreaker(counted(provider(), counter), {
      redis,
      persist,
      now: () => 1000,
    })
    await expect(drain(succeeding)).rejects.toMatchObject({
      name: "ProviderError",
      kind: "CircuitOpen",
    })
    expect(counter.n).toBe(0)
  })

  it("half-opens after resetMs and a successful probe closes it", async () => {
    const redis = redisFake()
    const persist = vi.fn().mockResolvedValue(undefined)
    let clock = 1000
    const failing = withBreaker(provider({ fail: true }), { redis, persist, now: () => clock })
    for (let i = 0; i < 3; i++) await expect(drain(failing)).rejects.toBeInstanceOf(ProviderError)

    clock = 1000 + 30_000
    const counter = { n: 0 }
    const succeeding = withBreaker(counted(provider(), counter), {
      redis,
      persist,
      now: () => clock,
    })
    await drain(succeeding)

    expect(counter.n).toBe(1) // probe reached upstream
    expect(await redis.get("breaker:p:state")).toBe("closed")
    expect(persist).toHaveBeenLastCalledWith("p", "closed", "success")
  })

  it("re-opens when the half-open probe also fails", async () => {
    const redis = redisFake()
    const persist = vi.fn().mockResolvedValue(undefined)
    let clock = 1000
    const failing = withBreaker(provider({ fail: true }), { redis, persist, now: () => clock })
    for (let i = 0; i < 3; i++) await expect(drain(failing)).rejects.toBeInstanceOf(ProviderError)

    clock = 1000 + 30_000
    const probeFails = withBreaker(provider({ fail: true }), { redis, persist, now: () => clock })
    await expect(drain(probeFails)).rejects.toBeInstanceOf(ProviderError)
    expect(await redis.get("breaker:p:state")).toBe("open")
  })

  it("does not count a cancelled run as a failure", async () => {
    const redis = redisFake()
    const persist = vi.fn().mockResolvedValue(undefined)
    const ac = new AbortController()
    ac.abort()
    const cancelled: OsintProvider<{ q: string }, { ok: true }> = {
      ...provider(),
      async *run() {
        yield { _tag: "Started" }
        throw new Error("aborted mid-run")
      },
    }
    const wrapped = withBreaker(cancelled, { redis, persist, now: () => 1000 })

    await expect(drain(wrapped, ac.signal)).rejects.toThrow("aborted mid-run")
    expect(await redis.get("breaker:p:failures")).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })
})
