import { z } from "zod"

export const emailrepInputSchema = z.object({
  email: z.string().email().max(254),
})

const reputationSchema = z.enum(["none", "low", "medium", "high"])

const emailrepDetailsSchema = z.object({
  blacklisted: z.boolean().optional(),
  malicious_activity: z.boolean().optional(),
  deliverable: z.boolean().optional(),
  first_seen: z.string().optional(),
  last_seen: z.string().optional(),
  domain_exists: z.boolean().optional(),
  domain_reputation: reputationSchema.optional(),
  profiles: z.array(z.string()).optional(),
  data_breach: z.boolean().optional(),
  credentials_leaked: z.boolean().optional(),
  spam: z.boolean().optional(),
})

export const emailrepOutputSchema = z.object({
  email: z.string(),
  reputation: reputationSchema,
  suspicious: z.boolean(),
  references: z.number().int().nonnegative(),
  details: emailrepDetailsSchema.optional(),
})

export type EmailrepInput = z.infer<typeof emailrepInputSchema>
export type EmailrepOutput = z.infer<typeof emailrepOutputSchema>
export type EmailrepDetails = z.infer<typeof emailrepDetailsSchema>
