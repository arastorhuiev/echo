import { z } from "zod"

export const phoneinfogaInputSchema = z.object({
  phone: z.string().min(1).max(32),
})

export const phoneinfogaLocalScannerSchema = z.object({
  valid: z.boolean(),
  country: z.string(),
  country_code: z.string(),
  carrier: z.string(),
  line_type: z.string(),
})

export const phoneinfogaOutputSchema = z.object({
  local_scanner: phoneinfogaLocalScannerSchema.nullable(),
  google_dorks: z.array(z.string().url()),
  error: z.string().nullable(),
})

export type PhoneinfogaInput = z.infer<typeof phoneinfogaInputSchema>
export type PhoneinfogaOutput = z.infer<typeof phoneinfogaOutputSchema>
export type PhoneinfogaLocalScanner = z.infer<typeof phoneinfogaLocalScannerSchema>
