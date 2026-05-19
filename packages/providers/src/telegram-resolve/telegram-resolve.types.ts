import { z } from "zod"

export const telegramResolveInputSchema = z.object({
  phone: z.string().min(1).max(32),
})

export const telegramResolveOutputSchema = z.object({
  configured: z.boolean(),
  found_on_telegram: z.boolean(),
  user_id: z.number().int().nullable().optional(),
  username: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  about: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  is_premium: z.boolean().nullable().optional(),
  is_bot: z.boolean().nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  is_scam: z.boolean().nullable().optional(),
  is_fake: z.boolean().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
})

export type TelegramResolveInput = z.infer<typeof telegramResolveInputSchema>
export type TelegramResolveOutput = z.infer<typeof telegramResolveOutputSchema>
