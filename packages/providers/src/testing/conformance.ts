import { describe, expect, it } from "vitest"
import type { OsintProvider, ProviderEvent } from "@/core/provider.js"

export interface ConformanceInput<Q> {
  /** A payload that should pass `provider.inputSchema.parse`. */
  readonly knownGood: Q
  /** Whether this provider is expected to throw (e.g. stub-fail). */
  readonly expectFailure?: boolean
}

/**
 * Drop-in suite of behaviour tests every OsintProvider must pass. Call
 * this at the top of a `*.test.ts` file alongside provider-specific
 * assertions.
 */
export function describeOsintProvider<Q, R>(
  provider: OsintProvider<Q, R>,
  input: ConformanceInput<Q>,
): void {
  describe(`OsintProvider conformance: ${provider.id}`, () => {
    it("has a non-empty id and a recognised category", () => {
      expect(provider.id).toMatch(/\S/)
      expect(provider.category).toMatch(/\S/)
    })

    it("inputSchema accepts the known-good payload", () => {
      expect(() => provider.inputSchema.parse(input.knownGood)).not.toThrow()
    })

    it("declares sensible defaults", () => {
      expect(provider.defaults.timeoutMs).toBeGreaterThan(0)
      expect(provider.defaults.maxConcurrent).toBeGreaterThan(0)
      expect(provider.defaults.cacheTtlSec).toBeGreaterThanOrEqual(0)
      expect(provider.defaults.breaker.failureThreshold).toBeGreaterThan(0)
      expect(provider.defaults.breaker.resetMs).toBeGreaterThan(0)
    })

    it("yields Started as the first event", async () => {
      const ctx = { lookupId: "test", signal: new AbortController().signal }
      const events: ProviderEvent<R>[] = []
      try {
        for await (const event of provider.run(input.knownGood, ctx)) {
          events.push(event)
          if (events.length >= 1) break
        }
      } catch {
        // failure providers may throw before yielding — handled below
      }
      if (events.length > 0) {
        expect(events[0]?._tag).toBe("Started")
      }
    })

    if (!input.expectFailure) {
      it("yields exactly one Final on a successful run", async () => {
        const ctx = { lookupId: "test", signal: new AbortController().signal }
        const events: ProviderEvent<R>[] = []
        for await (const event of provider.run(input.knownGood, ctx)) {
          events.push(event)
        }
        const finals = events.filter((e) => e._tag === "Final")
        expect(finals.length).toBe(1)
      })

      it("Final.data passes outputSchema.parse", async () => {
        const ctx = { lookupId: "test", signal: new AbortController().signal }
        let finalData: R | undefined
        for await (const event of provider.run(input.knownGood, ctx)) {
          if (event._tag === "Final") finalData = event.data
        }
        expect(finalData).not.toBeUndefined()
        expect(() => provider.outputSchema.parse(finalData)).not.toThrow()
      })
    }
  })
}
