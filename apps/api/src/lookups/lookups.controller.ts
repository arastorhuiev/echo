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
import { PublicHardeningGuard } from "@/hardening/public-hardening.guard"
import {
  type CancelLookupResult,
  type EnqueueLookupResult,
  LookupsService,
} from "@/lookups/lookups.service"
import { LookupSseStream } from "@/lookups/sse-stream"

const createLookupSchema = z.object({
  providerId: z.string().min(1),
  // Provider-specific shape is validated by the registry against
  // `provider.inputSchema` once we resolve the provider, so at the
  // edge we only assert the field exists.
  query: z.unknown(),
})

class CreateLookupDto extends createZodDto(createLookupSchema) {}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // For nginx/Cloudflare; harmless on Caddy
  "X-Accel-Buffering": "no",
} as const

/** Heartbeat interval for SSE connections — keeps proxies/load balancers from idling out. */
const SSE_HEARTBEAT_MS = 30_000

@Controller("lookups")
export class LookupsController {
  constructor(
    private readonly service: LookupsService,
    // See SidecarHealthIndicator for why AppConfigService needs @Inject.
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  /**
   * Enqueue a new lookup. Validates `providerId` against the registry
   * and `query` against the provider's inputSchema.
   */
  @Post()
  @UseGuards(PublicHardeningGuard, EntitlementGuard)
  create(@Body() body: CreateLookupDto, @Ip() ipAddress: string): Promise<EnqueueLookupResult> {
    return this.service.enqueue({
      providerId: body.providerId,
      query: body.query,
      ipAddress,
    })
  }

  /** Fetch a lookup row by id — useful as a fallback when SSE isn't an option. */
  @Get(":id")
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
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
   * Sends a `: ping` SSE comment every 30 s so HTTP proxies don't
   * close the long-lived connection. Closes the response when:
   * - a terminal event (`Final` / `Cancelled` / `Failed`) arrives
   * - the underlying stream has been idle for ~30 s with no new events
   *   (likely the lookup finished before SSE connected at terminal cursor)
   * - the client disconnects
   * - an unrecoverable Redis error occurs (a final `event: error` is
   *   written before close)
   */
  @Get(":id/stream")
  async stream(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const lastEventIdHeader = req.headers["last-event-id"]
    const lastEventId = typeof lastEventIdHeader === "string" ? lastEventIdHeader : undefined

    // `enableCors` in main.ts only decorates responses Nest sends via
    // its reply abstraction. SSE writes to `reply.raw` directly to keep
    // the stream uninterceptable, so we mirror the same localhost
    // allowlist here — without it the browser EventSource rejects the
    // response in dev (no ACAO header → CORS violation → onerror).
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
        // malformed Origin — silently skip CORS headers
      }
    }

    reply.raw.writeHead(200, { ...SSE_HEADERS, ...corsHeaders })

    const redisUrl = this.config.get("REDIS_URL")
    const stream = new LookupSseStream(redisUrl)

    const safeWrite = (chunk: string): void => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.write(chunk)
      }
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

  /** Request cancellation of an in-flight lookup. */
  @Delete(":id")
  cancel(@Param("id", ParseUUIDPipe) id: string): Promise<CancelLookupResult> {
    return this.service.cancel(id)
  }
}
