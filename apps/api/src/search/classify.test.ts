import { describe, expect, it } from "vitest"
import { classifyIdentifier } from "@/search/classify"

describe("classifyIdentifier", () => {
  it("detects email", () => {
    expect(classifyIdentifier("efinswim@gmail.com")).toBe("email")
    expect(classifyIdentifier("  a.b+tag@sub.example.co.uk ")).toBe("email")
  })

  it("detects an image URL", () => {
    expect(classifyIdentifier("https://cdn.example.com/photo.jpg")).toBe("image")
    expect(classifyIdentifier("http://x.io/a/b/c.PNG?v=2")).toBe("image")
  })

  it("treats a non-image http URL as unsupported (domain bucket)", () => {
    expect(classifyIdentifier("https://twitter.com/someuser")).toBe("domain")
  })

  it("detects phone numbers (E.164-ish)", () => {
    expect(classifyIdentifier("+48537529192")).toBe("phone")
    expect(classifyIdentifier("48537529192")).toBe("phone")
    expect(classifyIdentifier("+1 (202) 555-0175")).toBe("phone")
  })

  it("detects bare domains with a common TLD", () => {
    expect(classifyIdentifier("example.com")).toBe("domain")
    expect(classifyIdentifier("sub.example.io")).toBe("domain")
  })

  it("defaults to username, including dotted handles with non-TLD suffixes", () => {
    expect(classifyIdentifier("efinswim")).toBe("username")
    expect(classifyIdentifier("john.doe")).toBe("username")
    expect(classifyIdentifier("user_123")).toBe("username")
  })
})
