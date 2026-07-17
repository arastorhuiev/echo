import { describe, expect, it } from "vitest"
import { bullConnection, defaultQueueOptions } from "@/queue.config.js"
import { queueName } from "@/queue-names.js"

describe("queueName", () => {
  it("namespaces every provider under its own queue", () => {
    expect(queueName("maigret")).toBe("q.maigret")
    expect(queueName("hibp")).toBe("q.hibp")
  })
})

describe("bullConnection", () => {
  it("carries the url and the mandatory null retry budget", () => {
    expect(bullConnection("redis://cache:6379")).toEqual({
      url: "redis://cache:6379",
      maxRetriesPerRequest: null,
    })
  })
})

describe("defaultQueueOptions", () => {
  it("names the queue per provider and sets retry + retention defaults", () => {
    const opts = defaultQueueOptions({ providerId: "sherlock" })
    expect(opts.name).toBe("q.sherlock")
    expect(opts.defaultJobOptions.attempts).toBe(3)
    expect(opts.defaultJobOptions.backoff).toEqual({ type: "exponential", delay: 1_000 })
  })
})
