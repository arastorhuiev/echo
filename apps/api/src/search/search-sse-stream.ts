import { isTerminalEvent } from "@echo/providers"
import { searchEventsKey } from "@echo/queue"
import { Redis } from "ioredis"

const XREAD_BLOCK_MS = 1_000

/**
 * Pumps the aggregated `search:events:<id>` Redis Stream to an SSE consumer
 * (P12) — the search analogue of `LookupSseStream`. One dedicated ioredis
 * connection per request (BLOCK monopolises it); `dispose()` tears it down.
 * Returns when the search's terminal event (Final / Cancelled / Failed)
 * arrives or the client disconnects.
 */
export class SearchSseStream {
  private readonly subscriber: Redis
  private aborted = false

  constructor(redisUrl: string) {
    this.subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false })
  }

  async pumpTo(
    searchId: string,
    lastEventId: string | undefined,
    write: (chunk: string) => void,
  ): Promise<void> {
    let cursor = lastEventId ?? "0"
    while (!this.aborted) {
      const result = await this.subscriber.xread(
        "BLOCK",
        XREAD_BLOCK_MS,
        "STREAMS",
        searchEventsKey(searchId),
        cursor,
      )
      if (!result) continue

      for (const [, entries] of result) {
        for (const [streamId, fields] of entries) {
          cursor = streamId
          const data = fields[1] ?? ""
          write(`id: ${streamId}\ndata: ${data}\n\n`)
          if (this.isTerminal(data)) return
        }
      }
    }
  }

  dispose(): void {
    this.aborted = true
    this.subscriber.disconnect()
  }

  private isTerminal(data: string): boolean {
    try {
      return isTerminalEvent(JSON.parse(data))
    } catch {
      return false
    }
  }
}
