/**
 * Tiny SSE frame parser for the sidecar protocol.
 *
 * The sidecar emits frames in the shape:
 *   data: {<JSON>}\n\n
 * with no `event:` / `id:` / `retry:` fields. So a full parser is
 * overkill — we accumulate bytes into a buffer, split on the blank-line
 * terminator (`\n\n`), and pull the `data:` value out of each chunk.
 *
 * Multi-line `data:` payloads are concatenated per the SSE spec. Empty
 * frames and SSE comments (lines starting with `:`) are skipped.
 */
export class SseFrameParser {
  private buffer = ""

  /** Feed a decoded text chunk; returns 0+ data payloads ready to emit. */
  push(chunk: string): string[] {
    this.buffer += chunk
    const payloads: string[] = []

    while (true) {
      const sep = findFrameSeparator(this.buffer)
      if (sep === -1) break
      const rawFrame = this.buffer.slice(0, sep.index)
      this.buffer = this.buffer.slice(sep.end)

      const data = extractDataField(rawFrame)
      if (data !== undefined) payloads.push(data)
    }
    return payloads
  }

  /** Flush any trailing buffered frame at end-of-stream. */
  flush(): string[] {
    if (!this.buffer.trim()) return []
    const data = extractDataField(this.buffer)
    this.buffer = ""
    return data !== undefined ? [data] : []
  }
}

function findFrameSeparator(buf: string): { index: number; end: number } | -1 {
  // SSE separator is two newlines (`\n\n`) or two CRLF (`\r\n\r\n`).
  const nn = buf.indexOf("\n\n")
  const crlf = buf.indexOf("\r\n\r\n")
  if (nn === -1 && crlf === -1) return -1
  if (nn !== -1 && (crlf === -1 || nn < crlf)) return { index: nn, end: nn + 2 }
  return { index: crlf, end: crlf + 4 }
}

function extractDataField(frame: string): string | undefined {
  const dataLines: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue
    if (line.startsWith("data:")) {
      // SSE spec: a single space after `data:` is stripped if present.
      const rest = line.slice(5)
      dataLines.push(rest.startsWith(" ") ? rest.slice(1) : rest)
    }
  }
  if (dataLines.length === 0) return undefined
  return dataLines.join("\n")
}
