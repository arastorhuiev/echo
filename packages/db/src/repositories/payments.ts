import { eq } from "drizzle-orm"
import type { Db } from "@/client.js"
import { payments } from "@/schema/payments.js"

/**
 * Is there any succeeded payment? The reserved-schema read the P14
 * entitlement gate consults. The `payments` table is empty until P15 wires
 * real payments + auth, so this returns false today — a deliberate no-op
 * read that proves the path exists. P15 replaces this with a per-user
 * entitlement check.
 */
export async function hasSucceededPayment(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.status, "succeeded"))
    .limit(1)
  return row !== undefined
}
