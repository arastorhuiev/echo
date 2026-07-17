import { describe, expect, it } from "vitest"
import { applicableTargets } from "@/search/applicability"

describe("applicableTargets", () => {
  it("fans a username out to the username providers with a {username} query", () => {
    const targets = applicableTargets("username", "efinswim")
    const ids = targets.map((t) => t.providerId)
    expect(ids).toEqual(["sherlock", "maigret", "whatsmyname", "socialscan", "hudsonrock"])
    expect(targets.find((t) => t.providerId === "sherlock")?.query).toEqual({
      username: "efinswim",
    })
    expect(targets.find((t) => t.providerId === "socialscan")?.query).toEqual({
      queries: ["efinswim"],
    })
  })

  it("fans an email out to email-capable providers", () => {
    const targets = applicableTargets("email", "a@b.com")
    expect(targets.map((t) => t.providerId)).toEqual(["hudsonrock", "socialscan"])
    expect(targets[0]?.query).toEqual({ email: "a@b.com" })
  })

  it("strips non-digits for ignorant but keeps the raw phone for the others", () => {
    const targets = applicableTargets("phone", "+48 537-529-192")
    expect(targets.find((t) => t.providerId === "phonenumbers")?.query).toEqual({
      phone: "+48 537-529-192",
    })
    expect(targets.find((t) => t.providerId === "ignorant")?.query).toEqual({
      phone: "48537529192",
    })
  })

  it("maps an image identifier to exiftool", () => {
    expect(applicableTargets("image", "https://x/p.jpg")).toEqual([
      { providerId: "exiftool", query: { image_url: "https://x/p.jpg" } },
    ])
  })

  it("returns no targets for a domain (unsupported)", () => {
    expect(applicableTargets("domain", "example.com")).toEqual([])
  })
})
