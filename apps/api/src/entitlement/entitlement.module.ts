import { Global, Module } from "@nestjs/common"
import { EntitlementGuard } from "@/entitlement/entitlement.guard"
import { EntitlementService } from "@/entitlement/entitlement.service"

/**
 * Paywall seam (P14). Global so LookupsModule + SearchModule can apply
 * `@UseGuards(EntitlementGuard)` to their public POST routes without each
 * re-providing it. Consumes the global DB_CLIENT + ConfigService.
 */
@Global()
@Module({
  providers: [EntitlementService, EntitlementGuard],
  exports: [EntitlementService, EntitlementGuard],
})
export class EntitlementModule {}
