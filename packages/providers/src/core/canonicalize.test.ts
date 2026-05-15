import { describe, expect, it } from "vitest"
import { canonicalizeQuery, queryHash } from "@/core/canonicalize.js"

describe("canonicalizeQuery", () => {
  it("sorts top-level object keys", () => {
    expect(canonicalizeQuery({ b: 1, a: 2 })).toBe(canonicalizeQuery({ a: 2, b: 1 }))
  })

  it("sorts nested object keys recursively", () => {
    const a = canonicalizeQuery({ outer: { b: 1, a: 2 }, x: { y: 3, z: 4 } })
    const b = canonicalizeQuery({ x: { z: 4, y: 3 }, outer: { a: 2, b: 1 } })
    expect(a).toBe(b)
  })

  it("preserves array order (semantically meaningful)", () => {
    expect(canonicalizeQuery([3, 1, 2])).toBe("[3,1,2]")
    expect(canonicalizeQuery([3, 1, 2])).not.toBe(canonicalizeQuery([1, 2, 3]))
  })

  it("handles primitives", () => {
    expect(canonicalizeQuery("hi")).toBe('"hi"')
    expect(canonicalizeQuery(42)).toBe("42")
    expect(canonicalizeQuery(null)).toBe("null")
    expect(canonicalizeQuery(true)).toBe("true")
  })
})

describe("queryHash", () => {
  it("returns a 64-character hex string", () => {
    const h = queryHash({ x: 1 })
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it("is deterministic for the same input", () => {
    expect(queryHash({ a: 1 })).toBe(queryHash({ a: 1 }))
  })

  it("is invariant to object-key order", () => {
    expect(queryHash({ a: 1, b: 2 })).toBe(queryHash({ b: 2, a: 1 }))
  })

  it("differs for different inputs", () => {
    expect(queryHash({ a: 1 })).not.toBe(queryHash({ a: 2 }))
  })
})
