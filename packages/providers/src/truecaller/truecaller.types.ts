import { z } from "zod"

export const truecallerInputSchema = z.object({
  phone: z.string().min(1).max(32),
  country_code: z.string().max(8).optional(),
})

export const truecallerAddressSchema = z.object({
  city: z.string(),
  country_code: z.string(),
  address: z.string(),
})

export const truecallerSpamSchema = z.object({
  spam_score: z.number().int(),
  spam_type: z.string().nullable().optional(),
})

export const truecallerOutputSchema = z.object({
  configured: z.boolean(),
  found: z.boolean(),
  name: z.string().nullable().optional(),
  alt_name: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  addresses: z.array(truecallerAddressSchema).default([]),
  emails: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  spam_info: truecallerSpamSchema.nullable().optional(),
  score: z.number().nullable().optional(),
  access: z.string().nullable().optional(),
  enhanced: z.boolean().nullable().optional(),
  error: z.string().nullable().optional(),
})

export type TruecallerInput = z.infer<typeof truecallerInputSchema>
export type TruecallerOutput = z.infer<typeof truecallerOutputSchema>
export type TruecallerAddress = z.infer<typeof truecallerAddressSchema>
export type TruecallerSpamInfo = z.infer<typeof truecallerSpamSchema>
