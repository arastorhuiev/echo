import { Module } from "@nestjs/common"
import { LookupsController } from "@/lookups/lookups.controller"
import { LookupsService } from "@/lookups/lookups.service"
import { QueueRouter } from "@/lookups/queue-router"

/**
 * Producer side of the lookup pipeline. Consumes DB_CLIENT (global from
 * DbModule), REDIS (global from RedisModule), and OsintProviderRegistry
 * (global from OsintProviderRegistryModule.forRoot in AppModule).
 *
 * `QueueRouter` owns the per-provider BullMQ producer queues (P9b-core);
 * `LookupsService` routes each enqueue through it.
 */
@Module({
  controllers: [LookupsController],
  providers: [LookupsService, QueueRouter],
})
export class LookupsModule {}
