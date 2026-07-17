import { describe, expect, it } from "vitest"
import { type ChildResult, mergeSearchReport } from "@/search/merge"

describe("mergeSearchReport", () => {
  it("dedupes accounts by normalized URL and records every contributing provider", () => {
    const children: ChildResult[] = [
      {
        providerId: "sherlock",
        status: "done",
        data: { found: [{ name: "GitHub", url: "https://github.com/efinswim" }] },
      },
      {
        providerId: "maigret",
        status: "done",
        // Same profile, different casing + trailing slash → must dedupe to one.
        data: { found: [{ site: "GitHub", url: "https://GitHub.com/efinswim/" }] },
      },
      {
        providerId: "whatsmyname",
        status: "done",
        data: { found: [{ name: "Reddit", url: "https://reddit.com/u/efinswim" }] },
      },
    ]

    const report = mergeSearchReport("efinswim", "username", children)

    expect(report.providersRun).toBe(3)
    expect(report.providersSucceeded).toBe(3)
    expect(report.accounts).toHaveLength(2)
    const github = report.accounts.find((a) => a.url.toLowerCase().includes("github"))
    expect(github?.sources).toEqual(["maigret", "sherlock"])
  })

  it("counts failed children without failing the report", () => {
    const children: ChildResult[] = [
      { providerId: "sherlock", status: "done", data: { found: [] } },
      { providerId: "maigret", status: "failed", error: "sidecar down" },
      { providerId: "hudsonrock", status: "cancelled" },
    ]

    const report = mergeSearchReport("efinswim", "username", children)

    expect(report.providersSucceeded).toBe(1)
    expect(report.providersFailed).toBe(1)
    expect(report.accounts).toEqual([])
    expect(report.providers).toContainEqual({
      providerId: "maigret",
      status: "failed",
      error: "sidecar down",
    })
  })

  it("ignores malformed found entries", () => {
    const children: ChildResult[] = [
      {
        providerId: "sherlock",
        status: "done",
        data: { found: [{ name: "NoUrl" }, { url: 42 }, { url: "https://ok.com/x" }] },
      },
    ]
    const report = mergeSearchReport("x", "username", children)
    expect(report.accounts).toHaveLength(1)
    expect(report.accounts[0]?.url).toBe("https://ok.com/x")
  })
})
