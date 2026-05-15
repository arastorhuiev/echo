import {
  bigserial,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
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
  // UNIQUE so a worker retry that re-uses (lookupId, seq) gets a fast
  // failure instead of silently appending duplicates. The processor
  // wipes prior-attempt rows (`deleteByLookup`) before re-running so
  // the unique constraint is never actually hit in practice — it's a
  // belt-and-braces guard against a missed cleanup.
  (t) => [uniqueIndex("lookup_events_lookup_seq_unq").on(t.lookupId, t.seq)],
)

export type LookupEvent = typeof lookupEvents.$inferSelect
export type NewLookupEvent = typeof lookupEvents.$inferInsert
