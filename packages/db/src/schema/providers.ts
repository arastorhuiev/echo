import { boolean, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const breakerState = pgEnum("breaker_state", ["closed", "half_open", "open"])

export const providers = pgTable("providers", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  breakerState: breakerState("breaker_state").notNull().default("closed"),
  breakerOpenedAt: timestamp("breaker_opened_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
})

export type ProviderRow = typeof providers.$inferSelect
export type NewProviderRow = typeof providers.$inferInsert
export type BreakerState = (typeof breakerState.enumValues)[number]
