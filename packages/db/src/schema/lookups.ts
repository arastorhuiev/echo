import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "@/schema/users.js"

export const lookupStatus = pgEnum("lookup_status", [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
])

export const lookups = pgTable(
  "lookups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: text("provider_id").notNull(),
    queryHash: text("query_hash").notNull(),
    query: jsonb("query").$type<unknown>().notNull(),
    status: lookupStatus("status").notNull().default("queued"),
    result: jsonb("result").$type<unknown>(),
    errorKind: text("error_kind"),
    errorMessage: text("error_message"),
    ipAddress: text("ip_address"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("lookups_provider_query_hash_idx").on(t.providerId, t.queryHash),
    index("lookups_created_at_idx").on(t.createdAt.desc()),
    index("lookups_status_idx").on(t.status),
  ],
)

export type Lookup = typeof lookups.$inferSelect
export type NewLookup = typeof lookups.$inferInsert
export type LookupStatus = (typeof lookupStatus.enumValues)[number]
