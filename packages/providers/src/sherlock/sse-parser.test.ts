import { describe, expect, it } from "vitest"
import { SseFrameParser } from "@/sherlock/sse-parser.js"

describe("SseFrameParser", () => {
  it("parses a single complete frame", () => {
    const parser = new SseFrameParser()
    expect(parser.push("data: hello\n\n")).toEqual(["hello"])
  })

  it("buffers partial frames across chunks", () => {
    const parser = new SseFrameParser()
    expect(parser.push("data: hel")).toEqual([])
    expect(parser.push("lo\n\ndata: ")).toEqual(["hello"])
    expect(parser.push("world\n\n")).toEqual(["world"])
  })

  it("joins multi-line data fields with newline (SSE spec)", () => {
    const parser = new SseFrameParser()
    expect(parser.push("data: a\ndata: b\n\n")).toEqual(["a\nb"])
  })

  it("skips comment lines starting with colon", () => {
    const parser = new SseFrameParser()
    expect(parser.push(": ping\n\ndata: hi\n\n")).toEqual(["hi"])
  })

  it("strips the optional single space after `data:`", () => {
    const parser = new SseFrameParser()
    // No leading space — value starts at column 5.
    expect(parser.push("data:bare\n\n")).toEqual(["bare"])
    // With leading space — value starts at column 6 (space stripped).
    expect(parser.push("data: spaced\n\n")).toEqual(["spaced"])
  })

  it("handles CRLF separators", () => {
    const parser = new SseFrameParser()
    expect(parser.push("data: x\r\n\r\n")).toEqual(["x"])
  })

  it("flush() emits a trailing frame missing a terminator", () => {
    const parser = new SseFrameParser()
    parser.push("data: lonely")
    expect(parser.flush()).toEqual(["lonely"])
  })

  it("emits no payload for a frame without a data field", () => {
    const parser = new SseFrameParser()
    expect(parser.push("event: ping\n\n")).toEqual([])
  })
})
