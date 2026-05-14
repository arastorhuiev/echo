import { describe, expect, it } from "vitest"
import { describeOsintProvider } from "@/core/conformance.js"
import { ProviderError, type ProviderEvent } from "@/core/provider.js"
import { stubFailProvider } from "@/stubs/stub-fail.js"

describeOsintProvider(stubFailProvider, { knownGood: {}, expectFailure: true })

describe("stubFailProvider — failure path", () => {
  it("yields Started then throws ProviderError(Unknown)", async () => {
    const events: ProviderEvent[] = []
    const ctx = { lookupId: "test", signal: new AbortController().signal }
    let caught: unknown
    try {
      for await (const event of stubFailProvider.run({}, ctx)) {
        events.push(event)
      }
    } catch (err) {
      caught = err
    }

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ _tag: "Started" })
    expect(caught).toBeInstanceOf(ProviderError)
    const error = caught as ProviderError
    expect(error.providerId).toBe("stub-fail")
    expect(error.kind).toBe("Unknown")
    expect(error.message).toMatch(/stub-fail/)
  })
})
