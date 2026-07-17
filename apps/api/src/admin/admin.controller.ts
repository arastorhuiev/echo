import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common"
import { createZodDto } from "nestjs-zod"
import { z } from "zod"
import { AdminGuard } from "@/admin/admin.guard"
import { AdminService } from "@/admin/admin.service"

class SetEnabledDto extends createZodDto(z.object({ enabled: z.boolean() })) {}

/**
 * Ops cockpit JSON API (P13, D2/D3). Every route is bearer-token guarded.
 * No consumer UI — this is backend visibility + the two actionable toggles.
 */
@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Live snapshot: queues, per-provider breaker/health, cost, recent lookups. */
  @Get("status")
  status() {
    return this.admin.status()
  }

  /** Effective non-secret config + per-provider enabled/breaker/caps. */
  @Get("config")
  config() {
    return this.admin.effectiveConfig()
  }

  /** Enable/disable a provider — its next enqueue is rejected when disabled. */
  @Post("providers/:id/enabled")
  setEnabled(@Param("id") id: string, @Body() body: SetEnabledDto) {
    return this.admin.setProviderEnabled(id, body.enabled)
  }

  /** Reset a stuck breaker back to closed. */
  @Post("providers/:id/breaker/reset")
  resetBreaker(@Param("id") id: string) {
    return this.admin.resetBreaker(id)
  }
}
