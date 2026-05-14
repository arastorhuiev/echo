import { Q_LOOKUP } from "@echo/queue"
import { BullModule } from "@nestjs/bullmq"
import { Module } from "@nestjs/common"
import { LookupProcessor } from "@/lookups/lookup.processor"

/**
 * Consumer side of the lookup pipeline. registerQueue is required even
 * on the worker so @nestjs/bullmq constructs the BullMQ Worker bound
 * to `q.lookup` for the @Processor-decorated class.
 */
@Module({
  imports: [BullModule.registerQueue({ name: Q_LOOKUP })],
  providers: [LookupProcessor],
})
export class LookupsModule {}
