import { z } from "zod"

export const socialscanInputSchema = z.object({
  /** Mix of usernames + email addresses (socialscan auto-detects). 1-10 entries. */
  queries: z.array(z.string().min(1).max(254)).min(1).max(10),
})

export const socialscanResultEntrySchema = z.object({
  query: z.string(),
  platform: z.string(),
  available: z.boolean().nullable(),
  valid: z.boolean().nullable(),
  success: z.boolean().nullable(),
  message: z.string().optional(),
})

export const socialscanOutputSchema = z.object({
  results: z.array(socialscanResultEntrySchema),
  checked: z.number().int().nonnegative(),
})

export type SocialscanInput = z.infer<typeof socialscanInputSchema>
export type SocialscanOutput = z.infer<typeof socialscanOutputSchema>
export type SocialscanResultEntry = z.infer<typeof socialscanResultEntrySchema>

export const socialscanSidecarEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), query: z.string().optional() }),
  z.object({
    kind: z.literal("result"),
    query: z.string(),
    platform: z.string(),
    available: z.boolean().optional(),
    valid: z.boolean().optional(),
    success: z.boolean().optional(),
    message: z.string().optional(),
  }),
  z.object({ kind: z.literal("done"), checked: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
])

export type SocialscanSidecarEvent = z.infer<typeof socialscanSidecarEventSchema>
