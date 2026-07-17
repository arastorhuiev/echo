import { type OsintProvider, OsintProviderRegistry } from "@echo/providers"
import { ServiceUnavailableException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const { providersRepo, lookupsRepo } = vi.hoisted(() => ({
  providersRepo: { isEnabled: vi.fn() },
  lookupsRepo: { create: vi.fn(), markPaid: vi.fn() },
}))

vi.mock("@echo/db", () => ({
  repositories: { providers: providersRepo, lookups: lookupsRepo },
}))

import { LookupsService } from "@/lookups/lookups.service"

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

function makeService(add = vi.fn()) {
  const registry = new OsintProviderRegistry([fakeProvider("maigret")])
  // biome-ignore lint/suspicious/noExplicitAny: minimal DI stubs.
  const dbClient = { db: {} } as any
  // biome-ignore lint/suspicious/noExplicitAny: minimal DI stubs.
  const redis = {} as any
  const queues = { get: vi.fn(() => ({ add })) }
  // biome-ignore lint/suspicious/noExplicitAny: minimal DI stubs.
  return { service: new LookupsService(dbClient, redis, queues as any, registry), queues, add }
}

describe("LookupsService.enqueue — admin load-shed gate", () => {
  beforeEach(() => {
    providersRepo.isEnabled.mockReset()
    lookupsRepo.create.mockReset()
  })

  it("rejects with 503 when the provider is disabled — no row, no job", async () => {
    providersRepo.isEnabled.mockResolvedValue(false)
    const { service, add } = makeService()

    await expect(service.enqueue({ providerId: "maigret", query: {} })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    expect(lookupsRepo.create).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it("enqueues when the provider is enabled", async () => {
    providersRepo.isEnabled.mockResolvedValue(true)
    lookupsRepo.create.mockResolvedValue({ id: "L1" })
    const { service, add } = makeService()

    const result = await service.enqueue({ providerId: "maigret", query: {} })
    expect(result).toEqual({ id: "L1", streamUrl: "/api/lookups/L1/stream" })
    expect(add).toHaveBeenCalledOnce()
  })
})
