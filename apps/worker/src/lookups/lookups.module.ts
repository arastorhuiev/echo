import { Module } from "@nestjs/common"
import { LookupRunner } from "@/lookups/lookup-runner"
import { LookupWorkers } from "@/lookups/lookup-workers"

/**
 * Consumer side of the lookup pipeline (P9b-core). `LookupWorkers`
 * spins up one imperative BullMQ Worker per provider on module init,
 * each bound to `q.<providerId>` with its own concurrency cap; every
 * worker delegates to the shared provider-agnostic `LookupRunner`.
 */
@Module({
  providers: [LookupRunner, LookupWorkers],
})
export class LookupsModule {}
