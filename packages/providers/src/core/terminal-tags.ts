/**
 * Event tags that mark the end of a lookup run. The SSE handler closes
 * the HTTP response when it sees one; the worker stops persisting after
 * one. Single source of truth — don't duplicate the literal strings
 * elsewhere.
 */
export const TERMINAL_EVENT_TAGS = ["Final", "Cancelled", "Failed"] as const
export type TerminalEventTag = (typeof TERMINAL_EVENT_TAGS)[number]

const TERMINAL_TAG_SET: ReadonlySet<string> = new Set<string>(TERMINAL_EVENT_TAGS)

/** True if `value` is `{ _tag: "Final" | "Cancelled" | "Failed", ... }`. */
export function isTerminalEvent(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false
  const tag = (value as { _tag?: unknown })._tag
  return typeof tag === "string" && TERMINAL_TAG_SET.has(tag)
}
