import { z } from "zod"

export const saucenaoInputSchema = z.object({
  /** Public URL to the image we want SauceNAO to reverse-search. */
  image_url: z.string().url().max(2048),
})

export const saucenaoMatchSchema = z.object({
  similarity: z.number(),
  index_name: z.string(),
  source_urls: z.array(z.string().url()),
  thumbnail: z.string().url().optional(),
  twitter_user_handle: z.string().optional(),
})

export const saucenaoOutputSchema = z.object({
  matches: z.array(saucenaoMatchSchema),
  short_remaining: z.number().int().nullable(),
  long_remaining: z.number().int().nullable(),
})

export type SaucenaoInput = z.infer<typeof saucenaoInputSchema>
export type SaucenaoOutput = z.infer<typeof saucenaoOutputSchema>
export type SaucenaoMatch = z.infer<typeof saucenaoMatchSchema>
