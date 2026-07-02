import type { Redis } from "ioredis"
import { describe, expect, it } from "vitest"
import { costDay, trackProviderCost, wasCancelledWhileQueued } from "@/lookups/guards"

class FakeRedis {
  readonly store = new Map<string, string>()
  async get(k: string) {
    return this.store.get(k) ?? null
  }
  async set(k: string, v: string) {
    this.store.set(k, String(v))
    return "OK" as const
  }
  async incr(k: string) {
    const n = Number(this.store.get(k) ?? 0) + 1
    this.store.set(k, String(n))
    return n
  }
  async expire() {
    return 1
  }
}
const redisFake = () => new FakeRedis() as unknown as Redis
const fixedNow = () => new Date("2026-07-02T10:00:00Z")

describe("costDay", () => {
  it("formats a UTC date as YYYYMMDD", () => {
    expect(costDay(new Date("2026-07-02T23:59:00Z"))).toBe("20260702")
    expect(costDay(new Date("2026-01-05T00:00:00Z"))).toBe("20260105")
  })
})

describe("wasCancelledWhileQueued", () => {
  it("is false with no flag, true once the flag is set", async () => {
    const redis = redisFake()
    expect(await wasCancelledWhileQueued(redis, "l1")).toBe(false)
    await redis.set("lookup:cancelled:l1", "1")
    expect(await wasCancelledWhileQueued(redis, "l1")).toBe(true)
  })
})

describe("trackProviderCost", () => {
  it("increments once per run", async () => {
    const redis = redisFake()
    const a = await trackProviderCost({ redis, warnThreshold: 500, now: fixedNow }, "maigret")
    const b = await trackProviderCost({ redis, warnThreshold: 500, now: fixedNow }, "maigret")
    expect([a.count, b.count]).toEqual([1, 2])
  })

  it("flags crossedWarn exactly once — on threshold+1", async () => {
    const redis = redisFake()
    const crossed: boolean[] = []
    for (let i = 0; i < 4; i++) {
      crossed.push(
        (await trackProviderCost({ redis, warnThreshold: 2, now: fixedNow }, "p")).crossedWarn,
      )
    }
    expect(crossed).toEqual([false, false, true, false]) // counts 1,2,3,4
  })

  it("never flags when the warn threshold is 0", async () => {
    const redis = redisFake()
    const crossed: boolean[] = []
    for (let i = 0; i < 5; i++) {
      crossed.push(
        (await trackProviderCost({ redis, warnThreshold: 0, now: fixedNow }, "p")).crossedWarn,
      )
    }
    expect(crossed.some(Boolean)).toBe(false)
  })

  it("buckets separately per provider", async () => {
    const redis = redisFake()
    await trackProviderCost({ redis, warnThreshold: 500, now: fixedNow }, "a")
    const b = await trackProviderCost({ redis, warnThreshold: 500, now: fixedNow }, "b")
    expect(b.count).toBe(1)
  })
})
