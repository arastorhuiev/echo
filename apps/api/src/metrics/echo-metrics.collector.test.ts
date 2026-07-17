import { MetricsService } from "@echo/observability"
import { type OsintProvider, OsintProviderRegistry } from "@echo/providers"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

const { providersRepo } = vi.hoisted(() => ({ providersRepo: { list: vi.fn() } }))
vi.mock("@echo/db", () => ({ repositories: { providers: providersRepo } }))

import { breakerGaugeValue, EchoMetricsCollector } from "@/metrics/echo-metrics.collector"

function fakeProvider(id: string): OsintProvider {
  return {
    id,
    category: "meta",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    defaults: {
      timeoutMs: 1_000,
      maxConcurrent: 2,
      cacheTtlSec: 0,
      breaker: { failureThreshold: 5, resetMs: 30_000 },
    },
    async *run() {
      yield { _tag: "Final", data: null }
    },
  }
}

describe("breakerGaugeValue", () => {
  it("encodes breaker states as 0/1/2", () => {
    expect(breakerGaugeValue("closed")).toBe(0)
    expect(breakerGaugeValue("half_open")).toBe(1)
    expect(breakerGaugeValue("open")).toBe(2)
  })
})

describe("EchoMetricsCollector", () => {
  it("registers custom gauges that scrape live queue/breaker/cost values", async () => {
    const registry = new OsintProviderRegistry([fakeProvider("maigret")])
    const queues = { jobCounts: vi.fn().mockResolvedValue({ maigret: { waiting: 3, active: 1 } }) }
    const redis = { mget: vi.fn().mockResolvedValue(["7"]) }
    const dbClient = { db: {} }
    providersRepo.list.mockResolvedValue([{ id: "maigret", breakerState: "open" }])
    const metrics = new MetricsService()

    new EchoMetricsCollector(
      // biome-ignore lint/suspicious/noExplicitAny: minimal DI stubs.
      dbClient as any,
      // biome-ignore lint/suspicious/noExplicitAny: minimal DI stubs.
      redis as any,
      registry,
      // biome-ignore lint/suspicious/noExplicitAny: minimal DI stubs.
      queues as any,
      metrics,
    ).onModuleInit()

    const out = await metrics.metrics()
    expect(out).toContain('echo_queue_waiting{provider="maigret"} 3')
    expect(out).toContain('echo_queue_active{provider="maigret"} 1')
    expect(out).toContain('echo_breaker_state{provider="maigret"} 2')
    expect(out).toContain('echo_cost_total{provider="maigret"} 7')
  })
})
