import { describe, expect, it } from "vitest"
import type { ProviderEvent } from "@/core/provider.js"
import { stubSuccessProvider } from "@/stubs/stub-success.js"
import { describeOsintProvider } from "@/testing/conformance.js"

describeOsintProvider(stubSuccessProvider, { knownGood: { hello: "world" } })

describe("stubSuccessProvider — exact event sequence", () => {
  it("yields Started, three Progress (25/50/75), Final", async () => {
    const events: ProviderEvent[] = []
    const ctx = { lookupId: "test", signal: new AbortController().signal }
    for await (const event of stubSuccessProvider.run({ msg: "hi" }, ctx)) {
      events.push(event)
    }

    expect(events).toHaveLength(5)
    expect(events[0]).toEqual({ _tag: "Started" })
    expect(events[1]).toEqual({ _tag: "Progress", pct: 25 })
    expect(events[2]).toEqual({ _tag: "Progress", pct: 50 })
    expect(events[3]).toEqual({ _tag: "Progress", pct: 75 })
    expect(events[4]).toMatchObject({
      _tag: "Final",
      data: { ok: true, echoed: { msg: "hi" } },
    })
  })
})
