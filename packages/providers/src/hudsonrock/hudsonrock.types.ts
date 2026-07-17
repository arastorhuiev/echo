import { z } from "zod"

/**
 * Hudson Rock Cavalier accepts exactly one identifier — an email or a
 * username. The orchestrator (P12) routes a classified identifier here; a
 * single lookup always carries one or the other.
 */
export const hudsonRockInputSchema = z.union([
  z.object({ email: z.string().email() }),
  z.object({ username: z.string().min(1).max(256) }),
])

export const hudsonRockOutputSchema = z.object({
  /** True when the identifier appears in at least one infostealer log. */
  found: z.boolean(),
  /** Upstream human-readable message (compromised / not-found explanation). */
  message: z.string(),
  /** Count of infostealer records tied to the identifier. */
  stealerCount: z.number().int().nonnegative(),
  /** Raw per-stealer records (shape varies upstream — kept opaque). */
  stealers: z.array(z.unknown()),
})

export type HudsonRockInput = z.infer<typeof hudsonRockInputSchema>
export type HudsonRockOutput = z.infer<typeof hudsonRockOutputSchema>
