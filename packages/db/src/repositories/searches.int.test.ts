import { connectTestDb, type TestDbHandle } from "@test/helpers/db.js"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@/client.js"
import * as lookups from "@/repositories/lookups.js"
import * as searches from "@/repositories/searches.js"
import { lookups as lookupsTable } from "@/schema/lookups.js"
import { searches as searchesTable } from "@/schema/searches.js"

let handle: TestDbHandle
let db: Db

beforeAll(() => {
  handle = connectTestDb()
  db = handle.db
})

afterAll(async () => {
  await handle.close()
})

describe("searches repository (integration)", () => {
  it("creates a search with status=queued and the classified kind", async () => {
    const row = await searches.create(db, { identifier: "efinswim", kind: "username" })
    expect(typeof row.id).toBe("string")
    expect(row.status).toBe("queued")
    expect(row.kind).toBe("username")
    expect(row.identifier).toBe("efinswim")
    expect(row.report).toBeNull()
    expect(row.paidAt).toBeNull()
    expect(row.createdAt).toBeInstanceOf(Date)
  })

  it("transitions queued -> running -> done and persists the report", async () => {
    const s = await searches.create(db, { identifier: "u1", kind: "username" })
    await searches.markRunning(db, s.id)
    expect((await searches.findById(db, s.id))?.status).toBe("running")

    const report = { accounts: [{ url: "https://x/u1", sources: ["sherlock"] }] }
    await searches.markDone(db, s.id, report)
    const done = await searches.findById(db, s.id)
    expect(done?.status).toBe("done")
    expect(done?.report).toEqual(report)
    expect(done?.finishedAt).toBeInstanceOf(Date)
  })

  it("markPaid stamps paidAt without changing status", async () => {
    const s = await searches.create(db, { identifier: "u2", kind: "username" })
    await searches.markPaid(db, s.id)
    const cur = await searches.findById(db, s.id)
    expect(cur?.paidAt).toBeInstanceOf(Date)
    expect(cur?.status).toBe("queued")
  })

  it("bySearch returns the child lookups linked by search_id", async () => {
    const s = await searches.create(db, { identifier: "u3", kind: "username" })
    const a = await lookups.create(db, {
      providerId: "sherlock",
      queryHash: "h-a",
      query: {},
      searchId: s.id,
    })
    const b = await lookups.create(db, {
      providerId: "maigret",
      queryHash: "h-b",
      query: {},
      searchId: s.id,
    })
    // A standalone lookup (no search) must NOT be returned.
    await lookups.create(db, { providerId: "hibp", queryHash: "h-c", query: {} })

    const children = await lookups.bySearch(db, s.id)
    expect(children.map((c) => c.id).sort()).toEqual([a.id, b.id].sort())
    expect(children.map((c) => c.providerId).sort()).toEqual(["maigret", "sherlock"])
  })

  it("deleting a search cascades to its child lookups (ON DELETE CASCADE)", async () => {
    const s = await searches.create(db, { identifier: "u4", kind: "username" })
    const child = await lookups.create(db, {
      providerId: "sherlock",
      queryHash: "h-cascade",
      query: {},
      searchId: s.id,
    })
    await db.delete(searchesTable).where(eq(searchesTable.id, s.id))

    expect(await lookups.findById(db, child.id)).toBeNull()
    const remaining = await db
      .select({ id: lookupsTable.id })
      .from(lookupsTable)
      .where(eq(lookupsTable.searchId, s.id))
    expect(remaining).toHaveLength(0)
  })
})
