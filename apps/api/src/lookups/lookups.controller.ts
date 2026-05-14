import type { AppConfigService } from "@echo/config"
import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type { FastifyReply, FastifyRequest } from "fastify"
import {
  type CancelLookupResult,
  type EnqueueLookupResult,
  LookupsService,
} from "@/lookups/lookups.service"
import { LookupSseStream } from "@/lookups/sse-stream"

interface CreateLookupBody {
  providerId: string
  query: unknown
}

@Controller("lookups")
export class LookupsController {
  constructor(
    private readonly service: LookupsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Enqueue a new lookup. Validates `providerId` against the registry
   * and `query` against the provider's inputSchema.
   */
  @Post()
  create(@Body() body: CreateLookupBody, @Ip() ipAddress: string): Promise<EnqueueLookupResult> {
    return this.service.enqueue({
      providerId: body.providerId,
      query: body.query,
      ipAddress,
    })
  }

  /** Fetch a lookup row by id — useful as a fallback when SSE isn't an option. */
  @Get(":id")
  async findOne(@Param("id") id: string) {
    const row = await this.service.findById(id)
    if (!row) {
      throw new NotFoundException({ error: "LookupNotFound", id })
    }
    return row
  }

  /**
   * Server-Sent Events stream of provider events for one lookup. Reads
   * from a Redis Stream the worker writes to in lock-step with
   * `lookup_events`. Honours `Last-Event-ID` for clean reconnects.
   *
   * Closes when a terminal event (`Final`, `Cancelled`, `Failed`)
   * arrives or the client disconnects.
   */
  @Get(":id/stream")
  async stream(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const lastEventIdHeader = req.headers["last-event-id"]
    const lastEventId = typeof lastEventIdHeader === "string" ? lastEventIdHeader : undefined

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    })

    const redisUrl = (this.config as unknown as AppConfigService).get("REDIS_URL")
    const stream = new LookupSseStream(redisUrl)

    req.raw.on("close", () => stream.dispose())

    try {
      await stream.pumpTo(id, lastEventId, (chunk) => reply.raw.write(chunk))
    } finally {
      stream.dispose()
      if (!reply.raw.writableEnded) reply.raw.end()
    }
  }

  /** Request cancellation of an in-flight lookup. */
  @Delete(":id")
  cancel(@Param("id") id: string): Promise<CancelLookupResult> {
    return this.service.cancel(id)
  }
}
