import { Global, Module } from "@nestjs/common"
import { PublicHardeningGuard } from "@/hardening/public-hardening.guard"
import { LookupsModule } from "@/lookups/lookups.module"

/**
 * Public hardening (P9-pub). Global so the public controllers can apply
 * `@UseGuards(PublicHardeningGuard)` without re-providing it. Imports
 * LookupsModule for the exported QueueRouter (backpressure reads queue
 * depth). Consumes global REDIS / ConfigService / OsintProviderRegistry.
 */
@Global()
@Module({
  imports: [LookupsModule],
  providers: [PublicHardeningGuard],
  exports: [PublicHardeningGuard],
})
export class HardeningModule {}
