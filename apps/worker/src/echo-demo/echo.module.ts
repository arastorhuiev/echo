import { Q_ECHO } from "@echo/queue"
import { BullModule } from "@nestjs/bullmq"
import { Module } from "@nestjs/common"
import { EchoProcessor } from "@/echo-demo/echo.processor"

/**
 * Worker side of the P4 demo. registerQueue is required even on the
 * consumer side so @nestjs/bullmq can construct the underlying
 * BullMQ Worker bound to `q.echo` for the @Processor-decorated class.
 */
@Module({
  imports: [BullModule.registerQueue({ name: Q_ECHO })],
  providers: [EchoProcessor],
})
export class EchoDemoModule {}
