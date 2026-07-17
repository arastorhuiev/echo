import type { AppConfigService } from "@echo/config"
import { type OsintProvider, OsintProviderRegistry } from "@echo/providers"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const { queueInstances } = vi.hoisted(() => ({
  queueInstances: [] as Array<{ name: string; closed: boolean }>,
}))

vi.mock("bullmq", () => ({
  Queue: class {
    closed = false
    listeners: Record<string, unknown> = {}
    constructor(
      public name: string,
      public opts: unknown,
    ) {
      queueInstances.push(this)
    }
    on(event: string, cb: unknown) {
      this.listeners[event] = cb
      return this
    }
    async close() {
      this.closed = true
    }
  },
}))

import { QueueRouter } from "@/lookups/queue-router"

function fakeProvider(id: string, maxConcurrent = 4): OsintProvider {
  return {
    id,
    category: "meta",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    defaults: {
      timeoutMs: 1_000,
      maxConcurrent,
      cacheTtlSec: 0,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    },
    async *run() {
      yield { _tag: "Final", data: null }
    },
  }
}

const config = {
  get: (k: string) => (k === "REDIS_URL" ? "redis://localhost:6379" : undefined),
} as unknown as AppConfigService

describe("QueueRouter", () => {
  beforeEach(() => {
    queueInstances.length = 0
  })

  it("creates one q.<id> queue per provider and routes get() to it", () => {
    const registry = new OsintProviderRegistry([fakeProvider("maigret"), fakeProvider("hibp")])
    const router = new QueueRouter(registry, config)
    router.onModuleInit()

    expect(queueInstances.map((q) => q.name).sort()).toEqual(["q.hibp", "q.maigret"])
    expect(router.get("maigret").name).toBe("q.maigret")
    expect(router.get("hibp").name).toBe("q.hibp")
  })

  it("reports registration via has() and throws on get() for an unknown provider", () => {
    const registry = new OsintProviderRegistry([fakeProvider("maigret")])
    const router = new QueueRouter(registry, config)
    router.onModuleInit()

    expect(router.has("maigret")).toBe(true)
    expect(router.has("nope")).toBe(false)
    expect(() => router.get("nope")).toThrow(/no queue registered/i)
  })

  it("closes every queue on shutdown", async () => {
    const registry = new OsintProviderRegistry([fakeProvider("a"), fakeProvider("b")])
    const router = new QueueRouter(registry, config)
    router.onModuleInit()
    await router.onModuleDestroy()

    expect(queueInstances.every((q) => q.closed)).toBe(true)
  })
})
