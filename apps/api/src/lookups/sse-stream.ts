import { isTerminalEvent } from "@echo/providers"
import { lookupEventsKey } from "@echo/queue"
import { Redis } from "ioredis"

const XREAD_BLOCK_MS = 1_000

/**
 * Pumps Redis Stream entries for one lookup to an SSE consumer.
 *
 * One instance per HTTP request. The underlying ioredis connection is
 * dedicated (BLOCK commands monopolise the connection) and torn down by
 * `dispose()` when the client disconnects or a terminal event arrives.
 *
 * Resume semantics: `lastEventId` (passed via the `Last-Event-ID`
 * request header) becomes the XREAD cursor so reconnects don't replay
 * already-delivered events. `"0"` (default) reads the stream from the
 * beginning, which is correct for first-time connects.
 */
export class LookupSseStream {
  private readonly subscriber: Redis
  private aborted = false

  constructor(redisUrl: string) {
    this.subscriber = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    })
  }

  /**
   * Block-reads the stream and forwards each entry to `write` in
   * SSE format. Returns when a terminal event (`Final` / `Cancelled` /
   * `Failed`) arrives or `dispose()` is called.
   */
  async pumpTo(
    lookupId: string,
    lastEventId: string | undefined,
    write: (chunk: string) => void,
  ): Promise<void> {
    let cursor = lastEventId ?? "0"
    while (!this.aborted) {
      const result = await this.subscriber.xread(
        "BLOCK",
        XREAD_BLOCK_MS,
        "STREAMS",
        lookupEventsKey(lookupId),
        cursor,
      )
      if (!result) continue

      for (const [, entries] of result) {
        for (const [streamId, fields] of entries) {
          cursor = streamId
          // XADD wrote `*, data, <json>` — fields is ["data", "<json>"]
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
