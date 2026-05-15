import { z } from "zod"

/**
 * Allowed characters in a username we hand to the sidecar. Mirrors the
 * regex enforced server-side in `services/echo-osint-py/app/main.py` so
 * malformed input fails at the API edge instead of after a roundtrip.
 *
 * Conservatively excludes `@`, `+`, `~`, `/`, whitespace — sherlock
 * itself accepts them on some platforms but they break enough sites to
 * not be worth the noise for a v1.
 */
export const USERNAME_REGEX = /^[A-Za-z0-9._-]{1,50}$/

export const sherlockInputSchema = z.object({
  username: z.string().regex(USERNAME_REGEX),
})

export const sherlockFoundEntrySchema = z.object({
  site: z.string().min(1),
  url: z.string().url(),
})

export const sherlockOutputSchema = z.object({
  found: z.array(sherlockFoundEntrySchema),
  checked: z.number().int().nonnegative(),
})

export type SherlockInput = z.infer<typeof sherlockInputSchema>
export type SherlockOutput = z.infer<typeof sherlockOutputSchema>
export type SherlockFoundEntry = z.infer<typeof sherlockFoundEntrySchema>

/** Per-line event the sidecar sends over its SSE stream. Discriminated by `kind`. */
export const sidecarEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), username: z.string() }),
  z.object({ kind: z.literal("found"), site: z.string(), url: z.string() }),
  z.object({ kind: z.literal("not_found"), site: z.string() }),
  z.object({ kind: z.literal("done"), checked: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
])

export type SidecarEvent = z.infer<typeof sidecarEventSchema>
