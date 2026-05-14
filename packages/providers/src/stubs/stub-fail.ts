import { z } from "zod"
import { defaultsFor } from "@/core/defaults.js"
import { type OsintProvider, ProviderError } from "@/core/provider.js"

const inputSchema = z.object({}).passthrough()
const outputSchema = z.unknown() // never reached, but the interface requires a schema

type StubFailInput = z.infer<typeof inputSchema>

/**
 * Always-fails reference provider. Yields `Started`, then throws a
 * tagged ProviderError. Used by P5 to verify the error-path
 * persistence: lookups row marked `failed` + `_tag: "Failed"` event
 * appended to lookup_events.
 */
export const stubFailProvider: OsintProvider<StubFailInput, unknown> = {
  id: "stub-fail",
  category: "meta",
  inputSchema,
  outputSchema,
  defaults: defaultsFor("meta", {
    cacheTtlSec: 0,
    breaker: { failureThreshold: 1, resetMs: 5_000 },
  }),

  async *run() {
    yield { _tag: "Started" }
    throw new ProviderError("stub-fail", "Unknown", "stub-fail always throws (by design)")
  },
}
