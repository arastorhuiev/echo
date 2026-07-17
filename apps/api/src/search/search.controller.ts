import type { AppConfigService } from "@echo/config"
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type { FastifyReply, FastifyRequest } from "fastify"
import { createZodDto } from "nestjs-zod"
import { z } from "zod"
import { EntitlementGuard } from "@/entitlement/entitlement.guard"
import {
  type CancelSearchResult,
  type CreateSearchResult,
  SearchService,
} from "@/search/search.service"
import { SearchSseStream } from "@/search/search-sse-stream"

const createSearchSchema = z.object({
  identifier: z.string().min(1).max(320),
})

class CreateSearchDto extends createZodDto(createSearchSchema) {}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const

const SSE_HEARTBEAT_MS = 30_000

/**
 * Orchestrated-search API (P12). `POST /api/search` fans one identifier out
 * to every applicable provider; the stream carries the aggregated events and
 * a final merged report. No consumer UI — testable via API/Bruno/admin.
 */
@Controller("search")
export class SearchController {
  constructor(
    private readonly service: SearchService,
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  @Post()
  @UseGuards(EntitlementGuard)
  create(@Body() body: CreateSearchDto, @Ip() ipAddress: string): Promise<CreateSearchResult> {
    return this.service.createSearch({ identifier: body.identifier, ipAddress })
  }

  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
    const row = await this.service.findById(id)
    if (!row) throw new NotFoundException({ error: "SearchNotFound", id })
    return row
  }

  @Get(":id/stream")
  async stream(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const lastEventIdHeader = req.headers["last-event-id"]
    const lastEventId = typeof lastEventIdHeader === "string" ? lastEventIdHeader : undefined

    const origin = req.headers.origin
    const corsHeaders: Record<string, string> = {}
    if (typeof origin === "string") {
      try {
        const host = new URL(origin).hostname
        if (host === "localhost" || host === "127.0.0.1") {
          corsHeaders["Access-Control-Allow-Origin"] = origin
          corsHeaders.Vary = "Origin"
        }
      } catch {
        // malformed Origin — skip CORS headers
      }
    }

    reply.raw.writeHead(200, { ...SSE_HEADERS, ...corsHeaders })

    const stream = new SearchSseStream(this.config.get("REDIS_URL"))
    const safeWrite = (chunk: string): void => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.write(chunk)
    }
    const heartbeat = setInterval(() => safeWrite(": ping\n\n"), SSE_HEARTBEAT_MS)
    const cleanup = (): void => {
      clearInterval(heartbeat)
      stream.dispose()
    }
    req.raw.once("close", cleanup)

    try {
      await stream.pumpTo(id, lastEventId, safeWrite)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      safeWrite(`event: error\ndata: ${JSON.stringify({ message })}\n\n`)
    } finally {
      cleanup()
      if (!reply.raw.writableEnded) reply.raw.end()
    }
  }

  @Delete(":id")
  cancel(@Param("id", ParseUUIDPipe) id: string): Promise<CancelSearchResult> {
    return this.service.cancel(id)
  }
}
