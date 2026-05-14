import { eq, sql } from "drizzle-orm"
import type { Db } from "@/client.js"
import type { BreakerState, ProviderRow } from "@/schema/providers.js"
import { providers } from "@/schema/providers.js"

export type Outcome = "success" | "failure"

/**
 * Insert-or-update the per-provider runtime row. Affected timestamps are
 * stamped with `now`; unaffected timestamps are preserved from the existing
 * row via `ON CONFLICT DO UPDATE SET col = providers.col`.
 */
export async function upsertHealth(
  db: Db,
  id: string,
  state: BreakerState,
  outcome: Outcome,
): Promise<void> {
  const now = new Date()
  await db
    .insert(providers)
    .values({
      id,
      breakerState: state,
      breakerOpenedAt: state === "open" ? now : null,
      lastSuccessAt: outcome === "success" ? now : null,
      lastFailureAt: outcome === "failure" ? now : null,
    })
    .onConflictDoUpdate({
      target: providers.id,
      set: {
        breakerState: state,
        breakerOpenedAt: state === "open" ? now : sql`${providers.breakerOpenedAt}`,
        lastSuccessAt: outcome === "success" ? now : sql`${providers.lastSuccessAt}`,
        lastFailureAt: outcome === "failure" ? now : sql`${providers.lastFailureAt}`,
      },
    })
}

export interface BreakerSnapshot {
  readonly state: BreakerState
  readonly openedAt: Date | null
  readonly lastSuccessAt: Date | null
  readonly lastFailureAt: Date | null
}

export async function getBreakerState(db: Db, id: string): Promise<BreakerSnapshot | null> {
  const [row] = await db
    .select({
      state: providers.breakerState,
      openedAt: providers.breakerOpenedAt,
      lastSuccessAt: providers.lastSuccessAt,
      lastFailureAt: providers.lastFailureAt,
    })
    .from(providers)
    .where(eq(providers.id, id))
    .limit(1)
  return row ?? null
}

export async function findById(db: Db, id: string): Promise<ProviderRow | null> {
  const [row] = await db.select().from(providers).where(eq(providers.id, id)).limit(1)
  return row ?? null
}
