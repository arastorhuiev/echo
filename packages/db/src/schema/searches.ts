import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * An orchestrated search (P12): one identifier fanned out to every
 * applicable provider. Child rows live in `lookups` (each a real
 * per-provider run, linked via `lookups.search_id`); this row holds the
 * classified identifier and the merged/deduped `report` the aggregator
 * writes when the fan-out completes.
 */
export const searchStatus = pgEnum("search_status", [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
])

/** Identifier classification. `domain` is accepted but always `unsupported`. */
export const searchKind = pgEnum("search_kind", ["email", "username", "phone", "image", "domain"])

export const searches = pgTable(
  "searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    kind: searchKind("kind").notNull(),
    status: searchStatus("status").notNull().default("queued"),
    /** Merged, deduped aggregate written by the worker aggregator on completion. */
    report: jsonb("report").$type<unknown>(),
    /** Paywall stamp (P14) — set when the entitlement gate allowed the search. */
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("searches_created_at_idx").on(t.createdAt.desc())],
)

export type Search = typeof searches.$inferSelect
export type NewSearch = typeof searches.$inferInsert
export type SearchStatus = (typeof searchStatus.enumValues)[number]
export type SearchKind = (typeof searchKind.enumValues)[number]
