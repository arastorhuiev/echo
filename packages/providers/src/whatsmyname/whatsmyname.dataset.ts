import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type WmnDataset, type WmnSite, wmnDatasetSchema } from "@/whatsmyname/whatsmyname.types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATASET_PATH = join(HERE, "wmn-data.json")

let cached: WmnDataset | undefined

/**
 * Lazy-load the vendored WhatsMyName dataset (CC-BY-SA-4.0, see
 * `wmn-data.json` `.license` field). Parsed + validated on first call,
 * cached for the lifetime of the process.
 *
 * `source` shapes:
 * - `undefined` — load from the default vendored path (production).
 * - `string` — alternative file path (rarely needed outside packaging tests).
 * - `WmnDataset` — already-parsed dataset, bypasses I/O entirely. Tests
 *   pass a small fixture this way to avoid touching the 250 KB JSON.
 */
export async function loadWmnDataset(source?: string | WmnDataset): Promise<WmnDataset> {
  if (source !== undefined && typeof source !== "string") return source

  const path = source ?? DEFAULT_DATASET_PATH
  if (cached !== undefined && path === DEFAULT_DATASET_PATH) return cached
  const raw = await readFile(path, "utf-8")
  const parsed = wmnDatasetSchema.parse(JSON.parse(raw))
  if (path === DEFAULT_DATASET_PATH) cached = parsed
  return parsed
}

/** Reset cache — exported for tests so they can reload a fixture. */
export function resetWmnDatasetCache(): void {
  cached = undefined
}

/**
 * Sites we exclude from runtime fan-out:
 * - `post_body` set — needs HTTP POST with a templated body; out of MVP scope.
 *
 * Keeping the filter here (not in the provider) so other consumers of
 * the dataset (e.g. a CLI summariser) see the same filtered list.
 */
export function filterSupportedSites(sites: WmnSite[]): WmnSite[] {
  return sites.filter((s) => s.post_body === undefined)
}
