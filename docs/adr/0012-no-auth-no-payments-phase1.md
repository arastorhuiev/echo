# 0012. No auth or payments in Phase 1; schema reservations

**Status:** Accepted
**Date:** 2026-05-14

## Context

The user wants to ship the OSINT feature first and defer auth + payments. Two future product directions are on the table for "later": (a) require auth for any lookup, or (b) allow lookups but gate *results* behind payment. The Phase 1 system must avoid premature complexity *and* avoid painting itself into a corner that makes either future cheap to adopt.

## Decision

- **Phase 1 = anonymous public.** No authentication, no payments, no user-facing accounts.
- **Schema reservations** (in [0003](./0003-database-orm.md)'s Drizzle schema):
  - `users` table — empty, columns minimal: `id` (uuid), `email`, `created_at`. Reserved for future fill.
  - `lookups.user_id` — nullable foreign key to `users.id`. Always `NULL` in Phase 1.
  - `lookups.paid_at` — nullable timestamp. Always `NULL` in Phase 1.
  - `payments` table — empty, columns minimal: `id`, `user_id`, `provider`, `external_id`, `status`, `amount_cents`, `currency`, `created_at`. Reserved.
- **No code** for auth or payments in Phase 1: no controllers, no services, no middleware. Empty tables only.
- **Abuse posture without auth** is handled by [0010 (rate limiting)](./0010-rate-limiting-without-auth.md).
- **Result-gating logic** (Phase 3 paywall) lives in `LookupsController.findOne`: when implemented, return only `summary` (count, took, partial preview) when `paid_at IS NULL` and `user_id IS NOT NULL`.

## Consequences

**Good:**
- No premature complexity in Phase 1; faster to ship.
- Phase 3 migration is additive, not destructive — flip on auth, populate `users`, start writing `lookups.user_id`, add the paywall guard.
- Schema migration is trivial (just add columns / fill empty tables).
- Honest design: we don't pretend to have auth when we don't.

**Bad:**
- All Phase-1 traffic is anonymous → abuse posture leans entirely on rate limits and breakers.
- No per-user analytics, no quotas tied to identity until Phase 3.
- Empty tables in the schema may confuse a reader unfamiliar with the plan; mitigated by a `-- Phase 3 reservation` SQL comment on each empty table and reference back to this ADR.

## Alternatives considered

- **Full auth scaffold now** (login, session, password reset, etc.). Wastes time on something that may pivot when product direction firms up.
- **No schema reservations** (clean DB now, full migration later). Painful when Phase 3 arrives — we'd have to backfill `lookups.user_id` for already-paying anonymous users somehow.
- **Single-table-for-everything** (no `users` table; just an opaque `account_id` on `lookups`). Less flexible; we'd refactor anyway.

## Triggers to reconsider

- Product direction firms up on either "auth required" or "paywall" → write a Phase 3 ADR (e.g., 0013 — Authentication strategy, 0014 — Payment provider abstraction) and proceed.
- Abuse exceeds what rate limits can handle → introduce mandatory account creation as a cheap auth wall before payments are wired.
- Compliance / legal requirement appears (e.g., a jurisdiction requires identity verification for OSINT) → auth becomes mandatory regardless of product direction.

## Future-related ADRs (placeholders)

- `0013` — Authentication strategy (likely Better-Auth or Lucia v3).
- `0014` — Payment provider abstraction (Stripe + crypto + Privat24 + Monobank + LiqPay).
- `0015` — Result paywall mechanics.

These are not written yet — write them when Phase 3 begins.
