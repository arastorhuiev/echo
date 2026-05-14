import { z } from "zod"
import { defaultsFor } from "@/core/defaults.js"
import type { OsintProvider, ProviderRunContext } from "@/core/provider.js"

const inputSchema = z
  .object({
    /**
     * Optional delay between Progress events, in milliseconds. Used by
     * P6 SSE/cancel tests to make the stream observably slow. Honours
     * `ctx.signal` so cancellation is responsive.
     */
    delayMs: z.number().int().nonnegative().optional(),
  })
  .passthrough()

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

  async *run(query, ctx) {
    yield { _tag: "Started" }
    for (const pct of [25, 50, 75]) {
      yield { _tag: "Progress", pct }
      const ms = query.delayMs && query.delayMs > 0 ? query.delayMs : 5
      await delayWithSignal(ms, ctx.signal)
    }
    yield { _tag: "Final", data: { ok: true, echoed: query } }
  },
}

/**
 * Promise-wrapped setTimeout that rejects when the AbortSignal fires.
 * The clearTimeout in the abort handler keeps the timer from firing
 * after rejection (otherwise we'd resolve+reject the same promise).
 */
function delayWithSignal(ms: number, signal: ProviderRunContext["signal"]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new Error("aborted"))
      },
      { once: true },
    )
  })
}
