import { z } from "zod"

export const exiftoolInputSchema = z.object({
  image_url: z.string().url().max(2048),
})

export const exiftoolOutputSchema = z.object({
  found: z.boolean(),
  file_type: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  lens_model: z.string().nullable().optional(),
  software: z.string().nullable().optional(),
  date_taken: z.string().nullable().optional(),
  gps_latitude: z.string().nullable().optional(),
  gps_longitude: z.string().nullable().optional(),
  gps_altitude: z.string().nullable().optional(),
  gps_date: z.string().nullable().optional(),
  byline: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  copyright: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
  rights: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
})

export type ExiftoolInput = z.infer<typeof exiftoolInputSchema>
export type ExiftoolOutput = z.infer<typeof exiftoolOutputSchema>
