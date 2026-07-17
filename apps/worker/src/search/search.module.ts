import { Module } from "@nestjs/common"
import { SearchAggregator } from "@/search/search-aggregator"
import { SearchWorkers } from "@/search/search-workers"

/**
 * Search-orchestration consumer (P12). `SearchWorkers` runs the `q.search`
 * BullMQ Worker; each job delegates to the shared `SearchAggregator`, which
 * merges the child lookups' event streams into one report. Consumes global
 * DB_CLIENT / REDIS / ConfigService.
 */
@Module({
  providers: [SearchAggregator, SearchWorkers],
})
export class SearchModule {}
