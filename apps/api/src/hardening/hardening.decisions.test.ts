import { describe, expect, it } from "vitest"
import {
  isBackpressured,
  isOverCostCap,
  isRateLimited,
  minuteBucket,
} from "@/hardening/hardening.decisions"

describe("hardening decisions", () => {
  it("isRateLimited — off when limit is 0, trips only strictly over the limit", () => {
    expect(isRateLimited(100, 0)).toBe(false)
    expect(isRateLimited(10, 10)).toBe(false)
    expect(isRateLimited(11, 10)).toBe(true)
  })

  it("isBackpressured — off when max is 0, trips only strictly over max", () => {
    expect(isBackpressured(500, 0)).toBe(false)
    expect(isBackpressured(200, 200)).toBe(false)
    expect(isBackpressured(201, 200)).toBe(true)
  })

  it("isOverCostCap — off when cap is 0, trips only strictly over the cap", () => {
    expect(isOverCostCap(5_000, 0)).toBe(false)
    expect(isOverCostCap(1_000, 1_000)).toBe(false)
    expect(isOverCostCap(1_001, 1_000)).toBe(true)
  })

  it("minuteBucket advances once per 60s window", () => {
    expect(minuteBucket(0)).toBe(0)
    expect(minuteBucket(59_999)).toBe(0)
    expect(minuteBucket(60_000)).toBe(1)
    expect(minuteBucket(120_000)).toBe(2)
  })
})
