import { type CanActivate, Injectable } from "@nestjs/common"
import { EntitlementService } from "@/entitlement/entitlement.service"

/**
 * Applied to the public POST entrypoints only (`/api/lookups`, `/api/search`).
 * Delegates to EntitlementService.assertEntitled — which is a no-op while
 * PAYMENTS_ENABLED=false and throws 402 otherwise. NOT applied to the SSE
 * stream, GET, or DELETE routes, and NOT to orchestration children.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly entitlement: EntitlementService) {}

  async canActivate(): Promise<boolean> {
    await this.entitlement.assertEntitled()
    return true
  }
}
