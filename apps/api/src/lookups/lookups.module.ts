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
  // QueueRouter is exported so the ops cockpit (AdminModule, P13) can read
  // per-queue job counts and hand the queues to Bull-Board.
  exports: [QueueRouter],
})
export class LookupsModule {}
