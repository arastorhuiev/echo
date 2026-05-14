import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Phase 1 reservation. Empty in production until Phase 3 (auth) lands.
 * Schema matches the `lookups.user_id` foreign key. See ADR-0012.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export type UserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert
