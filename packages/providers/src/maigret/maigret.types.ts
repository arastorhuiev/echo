import { z } from "zod"
import { USERNAME_REGEX } from "@/sherlock/sherlock.types.js"

export const maigretInputSchema = z.object({
  username: z.string().regex(USERNAME_REGEX),
})

export const maigretFoundEntrySchema = z.object({
  site: z.string().min(1),
  url: z.string().url(),
})

export const maigretOutputSchema = z.object({
  found: z.array(maigretFoundEntrySchema),
  checked: z.number().int().nonnegative(),
})

export type MaigretInput = z.infer<typeof maigretInputSchema>
export type MaigretOutput = z.infer<typeof maigretOutputSchema>
export type MaigretFoundEntry = z.infer<typeof maigretFoundEntrySchema>

/**
 * Per-line event the sidecar's maigret runner sends over its SSE stream.
 * Shape mirrors Sherlock's sidecar events deliberately — they're both
 * username scanners — but kept as a separate schema so a future
 * divergence (e.g. extra metadata fields from Maigret) doesn't require
 * coordinating a Sherlock change.
 */
export const maigretSidecarEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), username: z.string() }),
  z.object({ kind: z.literal("found"), site: z.string(), url: z.string() }),
  z.object({ kind: z.literal("not_found"), site: z.string() }),
  z.object({ kind: z.literal("done"), checked: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
])

export type MaigretSidecarEvent = z.infer<typeof maigretSidecarEventSchema>
