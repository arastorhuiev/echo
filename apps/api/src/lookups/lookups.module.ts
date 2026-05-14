import { Q_LOOKUP } from "@echo/queue"
import { BullModule } from "@nestjs/bullmq"
import { Module } from "@nestjs/common"
import { LookupsController } from "@/lookups/lookups.controller"
import { LookupsService } from "@/lookups/lookups.service"

/**
 * Producer side of the lookup pipeline. Consumes DB_CLIENT (global from
 * DbModule) and OsintProviderRegistry (global from
 * OsintProviderRegistryModule.forRoot in AppModule).
 */
@Module({
  imports: [BullModule.registerQueue({ name: Q_LOOKUP })],
  controllers: [LookupsController],
  providers: [LookupsService],
})
export class LookupsModule {}
