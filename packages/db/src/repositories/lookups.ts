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
    })
    .returning()
  if (!row) throw new Error("INSERT...RETURNING returned no row")
  return row
}

export async function findById(db: Db, id: string): Promise<Lookup | null> {
  const [row] = await db.select().from(lookups).where(eq(lookups.id, id)).limit(1)
  return row ?? null
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
