import { Q_ECHO } from "@echo/queue"
import { InjectQueue } from "@nestjs/bullmq"
import { Body, Controller, Post } from "@nestjs/common"
import type { Queue } from "bullmq"

/**
 * Internal-only smoke-test endpoint for the P4 BullMQ wiring.
 *
 * The `/api/_internal/...` prefix is conventionally blocked at the
 * reverse proxy in production (Caddy / Cloudflare) — see Caddyfile
 * (currently a P11 reference). The controller itself is also gated
 * by `NODE_ENV !== production` in AppModule.
 */
@Controller("_internal/echo-job")
export class EchoController {
  constructor(@InjectQueue(Q_ECHO) private readonly queue: Queue) {}

  @Post()
  async enqueue(@Body() body: unknown): Promise<{ jobId: string; queue: string }> {
    const job = await this.queue.add("echo", body)
    return { jobId: job.id ?? "unknown", queue: this.queue.name }
  }
}
