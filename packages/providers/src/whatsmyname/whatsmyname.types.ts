import { z } from "zod"
import { USERNAME_REGEX } from "@/sherlock/sherlock.types.js"

export const whatsmynameInputSchema = z.object({
  username: z.string().regex(USERNAME_REGEX),
})

export const whatsmynameFoundEntrySchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  category: z.string(),
})

export const whatsmynameOutputSchema = z.object({
  found: z.array(whatsmynameFoundEntrySchema),
  /** Sites with a deterministic match (either FOUND or NOT_FOUND). */
  checked: z.number().int().nonnegative(),
  /** Total site definitions we attempted (post-skip filter). */
  total: z.number().int().nonnegative(),
})

export type WhatsmynameInput = z.infer<typeof whatsmynameInputSchema>
export type WhatsmynameOutput = z.infer<typeof whatsmynameOutputSchema>
export type WhatsmynameFoundEntry = z.infer<typeof whatsmynameFoundEntrySchema>

/**
 * Raw WhatsMyName site definition. The upstream dataset has a few
 * optional fields (`post_body`, `request_method`, `headers`) we ignore
 * in the MVP — sites needing POST or custom auth are filtered out at
 * load time, keeping the runner stateless and contention-free.
 */
export const wmnSiteSchema = z.object({
  name: z.string().min(1),
  uri_check: z.string().min(1),
  uri_pretty: z.string().optional(),
  e_code: z.number().int(),
  // Some upstream entries ship empty `e_string` / `m_string`. The runner
  // already short-circuits on those (`isMatch === undefined`), so the
  // schema just has to accept them rather than failing dataset load.
  e_string: z.string(),
  m_string: z.string(),
  m_code: z.number().int(),
  known: z.array(z.string()).optional(),
  cat: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  // Fields we currently ignore but accept so the schema doesn't reject
  // future revisions of the dataset:
  post_body: z.string().optional(),
  request_method: z.string().optional(),
  strip_bad_char: z.string().optional(),
  protection: z.unknown().optional(),
})

export const wmnDatasetSchema = z.object({
  license: z.array(z.string()).optional(),
  authors: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  sites: z.array(wmnSiteSchema),
})

export type WmnSite = z.infer<typeof wmnSiteSchema>
export type WmnDataset = z.infer<typeof wmnDatasetSchema>
