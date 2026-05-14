import { Q_ECHO } from "@echo/queue"
import { Processor, WorkerHost } from "@nestjs/bullmq"
import { Logger } from "@nestjs/common"
import type { Job } from "bullmq"

/**
 * Demo BullMQ processor for the `q.echo` queue. Receives whatever the
 * apps/api echo controller enqueued, logs it, and returns it as the
 * job result. Real OSINT providers (P5+) follow the same shape.
 */
@Processor(Q_ECHO)
export class EchoProcessor extends WorkerHost {
  private readonly logger = new Logger(EchoProcessor.name)

  async process(job: Job): Promise<unknown> {
    this.logger.log(
      `Processed job ${job.id} (queue=${job.queueName}, attempt=${job.attemptsMade + 1}): ${JSON.stringify(job.data)}`,
    )
    return job.data
  }
}
