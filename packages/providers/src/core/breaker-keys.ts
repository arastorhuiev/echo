/**
 * Redis keys backing the circuit-breaker state machine. Shared so the
 * breaker wrapper (which writes them) and the ops cockpit's "reset stuck
 * breaker" action (which clears them) can never drift on the key names.
 *
 * - `state`    — "closed" | "half_open" | "open"
 * - `failures` — consecutive-failure counter (INCR)
 * - `openedAt` — epoch ms the breaker opened (for the resetMs probe window)
 */
export function breakerKeys(providerId: string): {
  readonly state: string
  readonly failures: string
  readonly openedAt: string
} {
  return {
    state: `breaker:${providerId}:state`,
    failures: `breaker:${providerId}:failures`,
    openedAt: `breaker:${providerId}:opened_at`,
  }
}
