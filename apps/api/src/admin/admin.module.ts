import { Module } from "@nestjs/common"
import { AdminController } from "@/admin/admin.controller"
import { AdminGuard } from "@/admin/admin.guard"
import { AdminService } from "@/admin/admin.service"
import { LookupsModule } from "@/lookups/lookups.module"

/**
 * Ops cockpit (P13). Imports LookupsModule for its exported QueueRouter
 * (per-queue job counts + the queue set for Bull-Board). Consumes global
 * DB_CLIENT / REDIS / OsintProviderRegistry / ConfigService.
 */
@Module({
  imports: [LookupsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
