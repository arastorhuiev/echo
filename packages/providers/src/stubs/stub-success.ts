import { z } from "zod"
import { defaultsFor } from "@/core/defaults.js"
import type { OsintProvider } from "@/core/provider.js"

const inputSchema = z.object({}).passthrough()
const outputSchema = z.object({
  ok: z.literal(true),
  echoed: z.unknown(),
})

type StubSuccessInput = z.infer<typeof inputSchema>
type StubSuccessOutput = z.infer<typeof outputSchema>

/**
 * Always-succeeds reference provider used by P5 to exercise the
 * end-to-end pipeline (api -> queue -> worker -> registry -> wrappers
 * -> persistence -> SSE in P6). Yields a deterministic event sequence
 * the lookup processor can rely on for testing.
 */
export const stubSuccessProvider: OsintProvider<StubSuccessInput, StubSuccessOutput> = {
  id: "stub-success",
  category: "meta",
  inputSchema,
  outputSchema,
  defaults: defaultsFor("meta", { cacheTtlSec: 0 }),

  async *run(query) {
    yield { _tag: "Started" }
    for (const pct of [25, 50, 75]) {
      yield { _tag: "Progress", pct }
      await new Promise((r) => setTimeout(r, 5))
    }
    yield { _tag: "Final", data: { ok: true, echoed: query } }
  },
}
