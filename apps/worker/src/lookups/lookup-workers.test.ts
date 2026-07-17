import type { AppConfigService } from "@echo/config"
import { type OsintProvider, OsintProviderRegistry } from "@echo/providers"
import type { LookupJobData } from "@echo/queue"
import type { Job } from "bullmq"
import { beforeEach, describe, expect, it, vi } from "vitest"

interface MockWorker {
  name: string
  handler: (job: Job<LookupJobData>) => unknown
  opts: { concurrency: number }
  closed: boolean
}

const { workerInstances } = vi.hoisted(() => ({
  workerInstances: [] as MockWorker[],
}))

vi.mock("bullmq", () => ({
  Worker: class {
    closed = false
    listeners: Record<string, unknown> = {}
    constructor(
      public name: string,
      public handler: (job: Job<LookupJobData>) => unknown,
      public opts: { concurrency: number },
    ) {
      workerInstances.push(this as unknown as MockWorker)
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

import type { LookupRunner } from "@/lookups/lookup-runner"
import { LookupWorkers } from "@/lookups/lookup-workers"

// Worker-side test: stub the zod schemas (the worker never parses with
// them, and `zod` isn't a direct dependency of apps/worker).
const passthroughSchema = { parse: (v: unknown) => v } as unknown as OsintProvider["inputSchema"]

function fakeProvider(id: string, maxConcurrent: number): OsintProvider {
  return {
    id,
    category: "meta",
    inputSchema: passthroughSchema,
    outputSchema: passthroughSchema,
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

const fakeRunner = (run = vi.fn()) => ({ run }) as unknown as LookupRunner

describe("LookupWorkers", () => {
  beforeEach(() => {
    workerInstances.length = 0
  })

  it("starts one q.<id> worker per provider capped at maxConcurrent", () => {
    const registry = new OsintProviderRegistry([
      fakeProvider("maigret", 2),
      fakeProvider("phonenumbers", 16),
    ])
    new LookupWorkers(registry, fakeRunner(), config).onModuleInit()

    const byName = Object.fromEntries(workerInstances.map((w) => [w.name, w.opts.concurrency]))
    expect(byName).toEqual({ "q.maigret": 2, "q.phonenumbers": 16 })
  })

  it("delegates each job to the shared runner", async () => {
    const registry = new OsintProviderRegistry([fakeProvider("maigret", 2)])
    const run = vi.fn().mockResolvedValue({ ok: true })
    new LookupWorkers(registry, fakeRunner(run), config).onModuleInit()

    const job = { data: { lookupId: "l1", providerId: "maigret", query: {} } } as Job<LookupJobData>
    const worker = workerInstances[0]
    if (!worker) throw new Error("expected a worker to be created")
    await worker.handler(job)
    expect(run).toHaveBeenCalledWith(job)
  })

  it("closes every worker on shutdown", async () => {
    const registry = new OsintProviderRegistry([fakeProvider("a", 1), fakeProvider("b", 1)])
    const workers = new LookupWorkers(registry, fakeRunner(), config)
    workers.onModuleInit()
    await workers.onModuleDestroy()

    expect(workerInstances.every((w) => w.closed)).toBe(true)
  })
})
