import { z } from "zod"

export const ignorantInputSchema = z.object({
  /** Country dialling code WITHOUT the leading `+` (ignorant's positional convention). */
  country_code: z.string().min(1).max(4).regex(/^\d+$/),
  /** National-significant digits only — no `+`, no spaces. */
  phone: z.string().min(4).max(15).regex(/^\d+$/),
})

export const ignorantResultEntrySchema = z.object({
  platform: z.string(),
  domain: z.string().nullable().optional(),
  method: z.string().nullable().optional(),
  exists: z.boolean().nullable(),
  rate_limit: z.boolean().nullable().optional(),
  frequent_rate_limit: z.boolean().nullable().optional(),
})

export const ignorantOutputSchema = z.object({
  results: z.array(ignorantResultEntrySchema),
  checked: z.number().int().nonnegative(),
})

export type IgnorantInput = z.infer<typeof ignorantInputSchema>
export type IgnorantOutput = z.infer<typeof ignorantOutputSchema>
export type IgnorantResultEntry = z.infer<typeof ignorantResultEntrySchema>

/**
 * Per-line event the sidecar's ignorant runner sends over its SSE stream.
 * `result` events carry per-platform booleans; `done` carries the total
 * platform-check count.
 */
export const ignorantSidecarEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), phone: z.string().optional() }),
  z.object({
    kind: z.literal("result"),
    phone: z.string().optional(),
    platform: z.string(),
    domain: z.string().optional(),
    method: z.string().optional(),
    exists: z.boolean().optional(),
    rate_limit: z.boolean().optional(),
    frequent_rate_limit: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("done"), checked: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
])

export type IgnorantSidecarEvent = z.infer<typeof ignorantSidecarEventSchema>
