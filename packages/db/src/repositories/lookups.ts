import { and, desc, eq } from "drizzle-orm"
import type { Db } from "@/client.js"
import type { Lookup } from "@/schema/lookups.js"
import { lookups } from "@/schema/lookups.js"

export interface CreateLookupInput {
  providerId: string
  queryHash: string
  query: unknown
  ipAddress?: string | null
  userId?: string | null
  /** Parent orchestrated search (P12); null/undefined for a standalone lookup. */
  searchId?: string | null
}

export async function create(db: Db, input: CreateLookupInput): Promise<Lookup> {
  const [row] = await db
    .insert(lookups)
    .values({
      providerId: input.providerId,
      queryHash: input.queryHash,
      query: input.query,
      ipAddress: input.ipAddress ?? null,
      userId: input.userId ?? null,
      searchId: input.searchId ?? null,
    })
    .returning()
  if (!row) throw new Error("INSERT...RETURNING returned no row")
  return row
}

export async function findById(db: Db, id: string): Promise<Lookup | null> {
  const [row] = await db.select().from(lookups).where(eq(lookups.id, id)).limit(1)
  return row ?? null
}

export interface RecentLookup {
  readonly id: string
  readonly providerId: string
  readonly status: string
  readonly errorKind: string | null
  readonly createdAt: Date
  readonly startedAt: Date | null
  readonly finishedAt: Date | null
}

/**
 * The most recent `limit` lookups for the ops cockpit (P13 `/admin/status`).
 * Deliberately omits `query` / `ipAddress` / `result` — the admin recent
 * list must not surface raw PII (the retention/redaction follow-up is gated
 * before P11). Ordered newest-first via `lookups_created_at_idx`.
 */
export async function recent(db: Db, limit = 50): Promise<RecentLookup[]> {
  return db
    .select({
      id: lookups.id,
      providerId: lookups.providerId,
      status: lookups.status,
      errorKind: lookups.errorKind,
      createdAt: lookups.createdAt,
      startedAt: lookups.startedAt,
      finishedAt: lookups.finishedAt,
    })
    .from(lookups)
    .orderBy(desc(lookups.createdAt))
    .limit(limit)
}

/**
 * Returns the most recent successfully-completed lookup matching
 * (providerId, queryHash). Used by the cache lookup path.
 */
export async function findCachedByHash(
  db: Db,
  providerId: string,
  queryHash: string,
): Promise<Lookup | null> {
  const [row] = await db
    .select()
    .from(lookups)
    .where(
      and(
        eq(lookups.providerId, providerId),
        eq(lookups.queryHash, queryHash),
        eq(lookups.status, "done"),
      ),
    )
    .orderBy(desc(lookups.createdAt))
    .limit(1)
  return row ?? null
}

export interface ChildLookup {
  readonly id: string
  readonly providerId: string
  readonly status: string
}

/** The child lookups of an orchestrated search (P12), for cascade-cancel. */
export async function bySearch(db: Db, searchId: string): Promise<ChildLookup[]> {
  return db
    .select({ id: lookups.id, providerId: lookups.providerId, status: lookups.status })
    .from(lookups)
    .where(eq(lookups.searchId, searchId))
}

export async function markRunning(db: Db, id: string): Promise<void> {
  await db
    .update(lookups)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(lookups.id, id))
}

export async function markDone(db: Db, id: string, result: unknown): Promise<void> {
  await db
    .update(lookups)
    .set({ status: "done", result, finishedAt: new Date() })
    .where(eq(lookups.id, id))
}

export async function markFailed(
  db: Db,
  id: string,
  errorKind: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(lookups)
    .set({ status: "failed", errorKind, errorMessage, finishedAt: new Date() })
    .where(eq(lookups.id, id))
}

export async function markCancelled(db: Db, id: string): Promise<void> {
  await db
    .update(lookups)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(eq(lookups.id, id))
}
