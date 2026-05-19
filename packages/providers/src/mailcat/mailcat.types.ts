import { z } from "zod"

const USERNAME_REGEX = /^[A-Za-z0-9._-]{1,64}$/

export const mailcatInputSchema = z.object({
  username: z.string().regex(USERNAME_REGEX),
})

export const mailcatFoundEntrySchema = z.object({
  email: z.string(),
  exists: z.boolean(),
})

export const mailcatOutputSchema = z.object({
  /** Per-provider results — both existing-email hits and `exists: false` rejections. */
  results: z.array(mailcatFoundEntrySchema),
  /** Filtered to `exists: true` for caller convenience. */
  found: z.array(z.string()),
  checked: z.number().int().nonnegative(),
  /** Set when the sidecar reports `configured=false`. */
  error: z.string().nullable(),
})

export type MailcatInput = z.infer<typeof mailcatInputSchema>
export type MailcatOutput = z.infer<typeof mailcatOutputSchema>
export type MailcatFoundEntry = z.infer<typeof mailcatFoundEntrySchema>

export const mailcatSidecarEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), username: z.string().optional() }),
  z.object({
    kind: z.literal("result"),
    username: z.string().optional(),
    email: z.string(),
    exists: z.boolean(),
  }),
  z.object({ kind: z.literal("done"), checked: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
])

export type MailcatSidecarEvent = z.infer<typeof mailcatSidecarEventSchema>
