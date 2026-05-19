import { z } from "zod"

export const gravatarInputSchema = z.object({
  email: z.string().email().max(254),
})

export const gravatarVerifiedAccountSchema = z.object({
  service_type: z.string().min(1),
  service_label: z.string().min(1).optional(),
  url: z.string().url(),
})

export const gravatarProfileSchema = z.object({
  display_name: z.string().optional(),
  profile_url: z.string().url().optional(),
  avatar_url: z.string().url().optional(),
  avatar_alt_text: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  job_title: z.string().optional(),
  company: z.string().optional(),
  pronouns: z.string().optional(),
  pronunciation: z.string().optional(),
  verified_accounts: z.array(gravatarVerifiedAccountSchema).optional(),
})

export const gravatarOutputSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  found: z.boolean(),
  profile: gravatarProfileSchema.optional(),
})

export type GravatarInput = z.infer<typeof gravatarInputSchema>
export type GravatarOutput = z.infer<typeof gravatarOutputSchema>
export type GravatarProfile = z.infer<typeof gravatarProfileSchema>
