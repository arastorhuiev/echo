import { HttpException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { paymentsRepo } = vi.hoisted(() => ({
  paymentsRepo: { hasSucceededPayment: vi.fn() },
}))

vi.mock("@echo/db", () => ({ repositories: { payments: paymentsRepo } }))

import { EntitlementService } from "@/entitlement/entitlement.service"

function makeService(paymentsEnabled: boolean) {
  const config = {
    get: (k: string) => (k === "PAYMENTS_ENABLED" ? paymentsEnabled : undefined),
    // biome-ignore lint/suspicious/noExplicitAny: minimal typed-config stub.
  } as any
  // biome-ignore lint/suspicious/noExplicitAny: minimal DI stub.
  const dbClient = { db: {} } as any
  return new EntitlementService(dbClient, config)
}

describe("EntitlementService.assertEntitled", () => {
  beforeEach(() => {
    paymentsRepo.hasSucceededPayment.mockReset()
  })

  it("allows everything when payments are disabled (gate open) — no DB read", async () => {
    const service = makeService(false)
    await expect(service.assertEntitled()).resolves.toBeUndefined()
    expect(paymentsRepo.hasSucceededPayment).not.toHaveBeenCalled()
  })

  it("throws 402 when enabled and no entitlement exists", async () => {
    paymentsRepo.hasSucceededPayment.mockResolvedValue(false)
    const service = makeService(true)
    try {
      await service.assertEntitled()
      expect.fail("expected a 402")
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException)
      expect((err as HttpException).getStatus()).toBe(402)
    }
  })

  it("allows when enabled and a succeeded payment exists", async () => {
    paymentsRepo.hasSucceededPayment.mockResolvedValue(true)
    const service = makeService(true)
    await expect(service.assertEntitled()).resolves.toBeUndefined()
  })
})
