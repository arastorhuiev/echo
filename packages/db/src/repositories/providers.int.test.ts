import { connectTestDb, type TestDbHandle } from "@test/helpers/db.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@/client.js"
import * as providers from "@/repositories/providers.js"

let handle: TestDbHandle
let db: Db

beforeAll(() => {
  handle = connectTestDb()
  db = handle.db
})

afterAll(async () => {
  await handle.close()
})

describe("providers repository (integration)", () => {
  it("upsertHealth inserts a new row with state and outcome stamped", async () => {
    await providers.upsertHealth(db, "p-new", "closed", "success")
    const snap = await providers.getBreakerState(db, "p-new")
    expect(snap?.state).toBe("closed")
    expect(snap?.openedAt).toBeNull()
    expect(snap?.lastSuccessAt).toBeInstanceOf(Date)
    expect(snap?.lastFailureAt).toBeNull()
  })

  it("upsertHealth on existing row preserves the unaffected timestamps", async () => {
    await providers.upsertHealth(db, "p-update", "closed", "success")
    const before = await providers.getBreakerState(db, "p-update")
    const successAt = before?.lastSuccessAt

    await new Promise((r) => setTimeout(r, 10))

    await providers.upsertHealth(db, "p-update", "open", "failure")
    const after = await providers.getBreakerState(db, "p-update")

    expect(after?.state).toBe("open")
    expect(after?.openedAt).toBeInstanceOf(Date)
    expect(after?.lastFailureAt).toBeInstanceOf(Date)
    // lastSuccessAt was not touched on this upsert -> preserved
    expect(after?.lastSuccessAt?.getTime()).toBe(successAt?.getTime())
  })

  it("getBreakerState returns null for an unknown provider id", async () => {
    const snap = await providers.getBreakerState(db, "p-unknown")
    expect(snap).toBeNull()
  })

  it("findById returns the full provider row", async () => {
    await providers.upsertHealth(db, "p-full", "closed", "success")
    const row = await providers.findById(db, "p-full")
    expect(row?.id).toBe("p-full")
    expect(row?.enabled).toBe(true)
  })
})
