import { bigserial, index, integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core"
import { lookups } from "@/schema/lookups.js"

export const lookupEvents = pgTable(
  "lookup_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    lookupId: uuid("lookup_id")
      .notNull()
      .references(() => lookups.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("lookup_events_lookup_seq_idx").on(t.lookupId, t.seq)],
)

export type LookupEvent = typeof lookupEvents.$inferSelect
export type NewLookupEvent = typeof lookupEvents.$inferInsert
