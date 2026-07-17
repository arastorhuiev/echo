import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Constant-time string comparison. Both inputs are SHA-256 hashed first so
 * `timingSafeEqual` always sees equal-length buffers (it throws on length
 * mismatch) and the comparison leaks neither the length nor the position of
 * the first differing byte of the secret.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest()
  const hb = createHash("sha256").update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * Validate an `Authorization: Bearer <token>` header against the admin
 * token (the JSON `/admin/*` API auth). Empty/malformed header ⇒ false.
 */
export function bearerTokenValid(header: string | undefined, expected: string): boolean {
  if (!header) return false
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]
  if (!token) return false
  return constantTimeEqual(token, expected)
}

/**
 * Validate an `Authorization: Basic base64(user:pass)` header against the
 * admin token (the Bull-Board UI auth — browsers send Basic natively). The
 * password field is compared; the username is ignored. Empty/malformed
 * header ⇒ false.
 */
export function basicAuthValid(header: string | undefined, expected: string): boolean {
  if (!header) return false
  const match = /^Basic\s+(.+)$/i.exec(header.trim())
  const encoded = match?.[1]
  if (!encoded) return false
  let decoded: string
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8")
  } catch {
    return false
  }
  const sep = decoded.indexOf(":")
  const password = sep >= 0 ? decoded.slice(sep + 1) : decoded
  return constantTimeEqual(password, expected)
}
