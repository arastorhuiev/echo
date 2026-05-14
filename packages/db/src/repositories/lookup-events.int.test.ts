import { connectTestDb, type TestDbHandle } from "@test/helpers/db.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Db } from "@/client.js"
import * as lookupEvents from "@/repositories/lookup-events.js"
import * as lookups from "@/repositories/lookups.js"

let handle: TestDbHandle
let db: Db

beforeAll(() => {
  handle = connectTestDb()
  db = handle.db
})

afterAll(async () => {
  await handle.close()
})

describe("lookup_events repository (integration)", () => {
  it("append + listByLookup returns events ordered by seq", async () => {
    const lookup = await lookups.create(db, {
      providerId: "stub",
      queryHash: "events",
      query: {},
    })

    await lookupEvents.append(db, lookup.id, 1, { _tag: "Started" })
    await lookupEvents.append(db, lookup.id, 2, { _tag: "Progress", pct: 50 })
    await lookupEvents.append(db, lookup.id, 3, {
      _tag: "Final",
      data: { result: "ok" },
    })

    const events = await lookupEvents.listByLookup(db, lookup.id)
    expect(events).toHaveLength(3)
    expect(events[0]?.seq).toBe(1)
    expect(events[1]?.payload).toEqual({ _tag: "Progress", pct: 50 })
    expect(events[2]?.payload).toEqual({ _tag: "Final", data: { result: "ok" } })
  })
})
