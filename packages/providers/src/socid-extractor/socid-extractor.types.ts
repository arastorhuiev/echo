import { z } from "zod"

export const socidExtractorInputSchema = z.object({
  url: z.string().url().max(2048),
})

/**
 * Extracted fields are heterogeneous per site — socid_extractor returns
 * a flat dict where some values are strings, some are arrays of strings
 * (after our normalisation), and some are numbers/bools. Keep the
 * schema permissive at the runtime edge and let the UI render whatever
 * arrives.
 */
const fieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])

export const socidExtractorOutputSchema = z.object({
  found: z.boolean(),
  url: z.string(),
  fields: z.record(z.string(), fieldValueSchema),
  error: z.string().nullable(),
})

export type SocidExtractorInput = z.infer<typeof socidExtractorInputSchema>
export type SocidExtractorOutput = z.infer<typeof socidExtractorOutputSchema>
export type SocidExtractorFieldValue = z.infer<typeof fieldValueSchema>
