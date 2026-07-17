import type { SearchKind } from "@echo/db/schema"

/**
 * Classify a raw identifier into a search kind (P12). Person-lookup biased:
 * email / phone / image are detected by strong signals; a bare hostname
 * with a known TLD is `domain` (⇒ unsupported); everything else defaults to
 * `username` (the broadest, safest bucket for a person handle).
 *
 * Known limitation: a dotted handle whose last label is a common TLD (e.g.
 * `john.co`) classifies as `domain`. Rare in practice, and the caller can
 * always target a specific provider directly via `POST /api/lookups`.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const IMAGE_URL_RE = /^https?:\/\/\S+\.(?:jpe?g|png|gif|webp|bmp|tiff?)(?:\?\S*)?$/i
const HTTP_URL_RE = /^https?:\/\//i
// Common public TLDs — a bare hostname ending in one of these is treated as
// a domain. Deliberately small: over-matching steals handles from username.
const COMMON_TLDS = new Set([
  "com",
  "net",
  "org",
  "io",
  "co",
  "dev",
  "app",
  "info",
  "biz",
  "me",
  "xyz",
  "uk",
  "de",
  "fr",
  "ru",
  "us",
])
const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,24})$/i

export function classifyIdentifier(raw: string): SearchKind {
  const s = raw.trim()
  if (EMAIL_RE.test(s)) return "email"
  if (IMAGE_URL_RE.test(s)) return "image"
  // Any other http(s) URL (incl. a profile page or a non-image asset) is not
  // a person-identifier we fan out on → unsupported via the domain bucket.
  if (HTTP_URL_RE.test(s)) return "domain"
  if (isPhone(s)) return "phone"
  const host = HOSTNAME_RE.exec(s)
  if (host && COMMON_TLDS.has(host[1]?.toLowerCase() ?? "")) return "domain"
  return "username"
}

/** E.164-ish: optional leading +, 6–15 digits, only digits/space/dash/parens. */
function isPhone(s: string): boolean {
  if (!/^\+?[0-9][0-9\s\-()]*$/.test(s)) return false
  const digits = s.replace(/\D/g, "")
  return digits.length >= 6 && digits.length <= 15
}
