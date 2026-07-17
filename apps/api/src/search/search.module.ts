import { Module } from "@nestjs/common"
import { LookupsModule } from "@/lookups/lookups.module"
import { SearchController } from "@/search/search.controller"
import { SearchService } from "@/search/search.service"

/**
 * Search orchestration (P12). Imports LookupsModule for the exported
 * QueueRouter (children are enqueued on the per-provider queues). Consumes
 * global DB_CLIENT / REDIS / OsintProviderRegistry / ConfigService.
 */
@Module({
  imports: [LookupsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
