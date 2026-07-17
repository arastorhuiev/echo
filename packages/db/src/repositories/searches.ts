import { eq } from "drizzle-orm"
import type { Db } from "@/client.js"
import type { Search, SearchKind } from "@/schema/searches.js"
import { searches } from "@/schema/searches.js"

export interface CreateSearchInput {
  identifier: string
  kind: SearchKind
}

export async function create(db: Db, input: CreateSearchInput): Promise<Search> {
  const [row] = await db.insert(searches).values(input).returning()
  if (!row) throw new Error("INSERT...RETURNING returned no row")
  return row
}

export async function findById(db: Db, id: string): Promise<Search | null> {
  const [row] = await db.select().from(searches).where(eq(searches.id, id)).limit(1)
  return row ?? null
}

export async function markRunning(db: Db, id: string): Promise<void> {
  await db
    .update(searches)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(searches.id, id))
}

/** Terminal success: persist the merged report and stamp finishedAt. */
export async function markDone(db: Db, id: string, report: unknown): Promise<void> {
  await db
    .update(searches)
    .set({ status: "done", report, finishedAt: new Date() })
    .where(eq(searches.id, id))
}

export async function markFailed(db: Db, id: string): Promise<void> {
  await db
    .update(searches)
    .set({ status: "failed", finishedAt: new Date() })
    .where(eq(searches.id, id))
}

export async function markCancelled(db: Db, id: string): Promise<void> {
  await db
    .update(searches)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(eq(searches.id, id))
}
