import { z } from "zod"

export const hibpInputSchema = z.object({
  /**
   * Raw password the user submitted. Hashed client-side immediately on
   * receipt and NEVER persisted, logged, or sent to HIBP — only the first
   * 5 chars of the SHA-1 hash leave the process (k-anonymity contract).
   */
  password: z.string().min(1).max(1024),
})

export const hibpOutputSchema = z.object({
  pwned: z.boolean(),
  breach_count: z.number().int().nonnegative(),
})

export type HibpInput = z.infer<typeof hibpInputSchema>
export type HibpOutput = z.infer<typeof hibpOutputSchema>
