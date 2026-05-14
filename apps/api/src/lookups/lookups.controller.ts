import { Body, Controller, Get, Ip, NotFoundException, Param, Post } from "@nestjs/common"
import { type EnqueueLookupResult, LookupsService } from "@/lookups/lookups.service"

interface CreateLookupBody {
  providerId: string
  query: unknown
}

@Controller("lookups")
export class LookupsController {
  constructor(private readonly service: LookupsService) {}

  /**
   * Enqueue a new lookup. Validates `providerId` against the registry
   * and `query` against the provider's inputSchema. Returns the
   * lookup id and the SSE stream URL (P6).
   */
  @Post()
  create(@Body() body: CreateLookupBody, @Ip() ipAddress: string): Promise<EnqueueLookupResult> {
    return this.service.enqueue({
      providerId: body.providerId,
      query: body.query,
      ipAddress,
    })
  }

  /** Fetch a lookup row by id — used to poll status until SSE arrives in P6. */
  @Get(":id")
  async findOne(@Param("id") id: string) {
    const row = await this.service.findById(id)
    if (!row) {
      throw new NotFoundException({ error: "LookupNotFound", id })
    }
    return row
  }
}
