import { asc, eq } from "drizzle-orm"
import type { Db } from "../client.js"
import type { LookupEvent } from "../schema/lookup-events.js"
import { lookupEvents } from "../schema/lookup-events.js"

export async function append(
  db: Db,
  lookupId: string,
  seq: number,
  payload: unknown,
): Promise<void> {
  await db.insert(lookupEvents).values({ lookupId, seq, payload })
}

export async function listByLookup(db: Db, lookupId: string): Promise<LookupEvent[]> {
  return db
    .select()
    .from(lookupEvents)
    .where(eq(lookupEvents.lookupId, lookupId))
    .orderBy(asc(lookupEvents.seq))
}
