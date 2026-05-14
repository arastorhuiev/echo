import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users.js"

/**
 * Phase 1 reservation. Empty in production until Phase 3 (paywall) lands.
 * No code touches this table in Phase 1 — it exists so the migration to
 * Phase 3 is additive, not destructive. See ADR-0012.
 */
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  status: text("status").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export type PaymentRow = typeof payments.$inferSelect
export type NewPaymentRow = typeof payments.$inferInsert
