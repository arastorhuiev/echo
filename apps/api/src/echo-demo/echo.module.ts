import { Q_ECHO } from "@echo/queue"
import { BullModule } from "@nestjs/bullmq"
import { Module } from "@nestjs/common"
import { EchoController } from "@/echo-demo/echo.controller"

/**
 * Demo feature for P4 — registers the `q.echo` queue as a producer and
 * exposes the internal smoke-test endpoint. Worker side has the
 * matching processor in apps/worker/src/echo-demo/echo.processor.ts.
 *
 * AppModule imports this conditionally on `NODE_ENV !== production`.
 */
@Module({
  imports: [BullModule.registerQueue({ name: Q_ECHO })],
  controllers: [EchoController],
})
export class EchoDemoModule {}
