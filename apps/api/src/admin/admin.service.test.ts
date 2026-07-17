import { breakerKeys, type OsintProvider, OsintProviderRegistry } from "@echo/providers"
import { NotFoundException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const { providersRepo, lookupsRepo } = vi.hoisted(() => ({
  providersRepo: { list: vi.fn(), setEnabled: vi.fn(), resetBreaker: vi.fn() },
  lookupsRepo: { recent: vi.fn() },
}))

vi.mock("@echo/db", () => ({
  repositories: { providers: providersRepo, lookups: lookupsRepo },
}))

import { AdminService } from "@/admin/admin.service"

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

function makeService() {
  const registry = new OsintProviderRegistry([fakeProvider("maigret")])
  const redis = { del: vi.fn() }
  // biome-ignore lint/suspicious/noExplicitAny: minimal DI stubs.
  const dbClient = { db: {} } as any
  // biome-ignore lint/suspicious/noExplicitAny: minimal DI stubs.
  const config = { get: () => "" } as any
  // biome-ignore lint/suspicious/noExplicitAny: minimal DI stubs.
  const queues = {} as any
  // biome-ignore lint/suspicious/noExplicitAny: minimal DI stubs.
  const service = new AdminService(dbClient, redis as any, registry, config, queues)
  return { service, redis }
}

describe("AdminService toggles", () => {
  beforeEach(() => {
    providersRepo.setEnabled.mockReset()
    providersRepo.resetBreaker.mockReset()
  })

  it("setProviderEnabled persists the flag for a known provider", async () => {
    const { service } = makeService()
    const result = await service.setProviderEnabled("maigret", false)
    expect(result).toEqual({ id: "maigret", enabled: false })
    expect(providersRepo.setEnabled).toHaveBeenCalledWith({}, "maigret", false)
  })

  it("resetBreaker clears the live Redis keys AND the DB mirror", async () => {
    const { service, redis } = makeService()
    const result = await service.resetBreaker("maigret")
    expect(result).toEqual({ id: "maigret", breakerState: "closed" })
    const keys = breakerKeys("maigret")
    expect(redis.del).toHaveBeenCalledWith(keys.state, keys.failures, keys.openedAt)
    expect(providersRepo.resetBreaker).toHaveBeenCalledWith({}, "maigret")
  })

  it("rejects an unknown provider with 404 and no write", async () => {
    const { service, redis } = makeService()
    await expect(service.setProviderEnabled("nope", true)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.resetBreaker("nope")).rejects.toBeInstanceOf(NotFoundException)
    expect(providersRepo.setEnabled).not.toHaveBeenCalled()
    expect(providersRepo.resetBreaker).not.toHaveBeenCalled()
    expect(redis.del).not.toHaveBeenCalled()
  })
})
