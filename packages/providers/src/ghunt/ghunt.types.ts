import { z } from "zod"

export const ghuntInputSchema = z.object({
  email: z.string().email().max(254),
})

export const ghuntOutputSchema = z.object({
  configured: z.boolean(),
  found: z.boolean(),
  name: z.string().nullable().optional(),
  gaia_id: z.string().nullable().optional(),
  profile_picture: z.string().nullable().optional(),
  cover_photo: z.string().nullable().optional(),
  emails: z.array(z.string()).default([]),
  reviews_count: z.number().int().nullable().optional(),
  maps_contributions: z.number().int().nullable().optional(),
  calendar_visible: z.boolean().nullable().optional(),
  error: z.string().nullable().optional(),
})

export type GhuntInput = z.infer<typeof ghuntInputSchema>
export type GhuntOutput = z.infer<typeof ghuntOutputSchema>
