import { describe, expect, it } from "vitest"
import { basicAuthValid, bearerTokenValid, constantTimeEqual } from "@/admin/admin-auth"

const TOKEN = "s3cr3t-admin-token"
const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`

describe("constantTimeEqual", () => {
  it("is true for identical strings, false otherwise", () => {
    expect(constantTimeEqual(TOKEN, TOKEN)).toBe(true)
    expect(constantTimeEqual(TOKEN, `${TOKEN}x`)).toBe(false)
    expect(constantTimeEqual("", "")).toBe(true)
    expect(constantTimeEqual("a", "b")).toBe(false)
  })
})

describe("bearerTokenValid", () => {
  it("accepts the exact token (case-insensitive scheme)", () => {
    expect(bearerTokenValid(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(bearerTokenValid(`bearer ${TOKEN}`, TOKEN)).toBe(true)
  })
  it("rejects a wrong/absent/malformed header", () => {
    expect(bearerTokenValid(`Bearer ${TOKEN}x`, TOKEN)).toBe(false)
    expect(bearerTokenValid(undefined, TOKEN)).toBe(false)
    expect(bearerTokenValid("", TOKEN)).toBe(false)
    expect(bearerTokenValid(TOKEN, TOKEN)).toBe(false) // no scheme
    expect(bearerTokenValid(`Basic ${TOKEN}`, TOKEN)).toBe(false)
  })
})

describe("basicAuthValid", () => {
  it("accepts the token in the password field, any username", () => {
    expect(basicAuthValid(basic("admin", TOKEN), TOKEN)).toBe(true)
    expect(basicAuthValid(basic("", TOKEN), TOKEN)).toBe(true)
  })
  it("rejects a wrong password / absent / malformed header", () => {
    expect(basicAuthValid(basic("admin", "nope"), TOKEN)).toBe(false)
    expect(basicAuthValid(undefined, TOKEN)).toBe(false)
    expect(basicAuthValid(`Bearer ${TOKEN}`, TOKEN)).toBe(false)
  })
})
