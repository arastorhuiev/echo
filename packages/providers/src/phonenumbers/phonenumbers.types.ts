import { z } from "zod"

export const phonenumbersInputSchema = z.object({
  /**
   * Phone in E.164 (`+CC...`) or any format libphonenumber can parse.
   * The sidecar refuses parses without a country prefix; the schema is
   * intentionally permissive at the TS edge so callers see the parse
   * error message rather than a 422.
   */
  phone: z.string().min(1).max(32),
})

export const phonenumbersOutputSchema = z.object({
  valid: z.boolean(),
  possible: z.boolean(),
  e164: z.string().nullable(),
  national_format: z.string().nullable(),
  international_format: z.string().nullable(),
  country_code: z.number().int().nullable(),
  region_code: z.string().nullable(),
  number_type: z.enum([
    "FIXED_LINE",
    "MOBILE",
    "FIXED_LINE_OR_MOBILE",
    "TOLL_FREE",
    "PREMIUM_RATE",
    "SHARED_COST",
    "VOIP",
    "PERSONAL_NUMBER",
    "PAGER",
    "UAN",
    "VOICEMAIL",
    "UNKNOWN",
  ]),
  carrier_name: z.string(),
  geocoded_location: z.string(),
  timezones: z.array(z.string()),
  parse_error: z.string().nullable(),
})

export type PhonenumbersInput = z.infer<typeof phonenumbersInputSchema>
export type PhonenumbersOutput = z.infer<typeof phonenumbersOutputSchema>
