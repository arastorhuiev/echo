import { connectTestDb, type TestDbHandle } from "@test/helpers/db.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@/client.js"
import * as payments from "@/repositories/payments.js"
import { payments as paymentsTable } from "@/schema/payments.js"

let handle: TestDbHandle
let db: Db

beforeAll(() => {
  handle = connectTestDb()
  db = handle.db
})

afterAll(async () => {
  await handle.close()
})

describe("payments repository (integration) — P14 reserved-schema read", () => {
  it("hasSucceededPayment is false when the table has no succeeded row", async () => {
    // A non-succeeded payment must not count.
    await db
      .insert(paymentsTable)
      .values({ provider: "stripe", status: "pending", amountCents: 2000, currency: "eur" })
    expect(await payments.hasSucceededPayment(db)).toBe(false)
  })

  it("hasSucceededPayment is true once a succeeded payment exists", async () => {
    await db
      .insert(paymentsTable)
      .values({ provider: "stripe", status: "succeeded", amountCents: 2000, currency: "eur" })
    expect(await payments.hasSucceededPayment(db)).toBe(true)
  })
})
