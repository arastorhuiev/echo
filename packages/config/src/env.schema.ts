import { z } from "zod"

/**
 * Validated process.env shape for echo apps. Both `apps/api` and `apps/worker`
 * read the same schema — fields they don't use are still validated, so the
 * stack fails fast at startup if anything is missing or malformed.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  PORT: z.coerce.number().int().positive().default(3000),

  // Postgres / Drizzle
  DATABASE_URL: z.string().url(),

  // Redis (cache + BullMQ + SSE event bus)
  REDIS_URL: z.string().url(),

  // OSINT Python sidecar — required from P7 onward. Workers calling
  // Python-only providers (Sherlock, Maigret, …) fail fast if this is
  // missing; api uses it for the readiness check too.
  OSINT_PY_URL: z.string().url(),

  // OpenTelemetry — optional; without an OTLP endpoint the app still
  // collects spans for in-process consumers but doesn't export anywhere.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default("echo-app"),

  // Metrics endpoint allowlist (CSV of CIDR/IPs) — empty = open in dev,
  // production should set this to limit /api/metrics access.
  METRICS_ALLOWLIST: z.string().optional(),

  // Per-provider daily run-count soft warning (P9b-core cost counter).
  // The worker logs once when a provider crosses this many runs in a UTC
  // day; 0 disables the warning. Hard enforcement is deferred to P9-pub.
  COST_DAILY_WARN: z.coerce.number().int().nonnegative().default(500),

  // Ops cockpit admin token (P13). Guards every /admin/* JSON endpoint
  // AND the Bull-Board UI at /admin/queues. Required non-empty so the
  // stack fails fast rather than booting an unprotected admin surface;
  // compared in constant time. Rotate by changing this and restarting.
  ADMIN_TOKEN: z.string().min(1),

  // Paywall seam (P14). `false` (default) ⇒ the entitlement gate is OPEN:
  // every public lookup/search is allowed and stamped paid, so results stay
  // testable end-to-end. `true` ⇒ require a paid entitlement (402 without
  // one) — flipped on when real payments (P15) land. Parsed explicitly
  // because a bare `z.coerce.boolean()` treats the string "false" as true.
  PAYMENTS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Public hardening (P9-pub, pre-deploy exposure-only). All DEFAULT-OFF so
  // local dev + CI are never throttled; production sets the real values just
  // before P11. A `0` / empty value disables that check entirely.
  //
  // Per-IP fixed-window rate limit on the public POST routes (req / 60 s).
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().nonnegative().default(0),
  // Reject a public POST with 503 when total waiting jobs exceed this.
  QUEUE_BACKPRESSURE_MAX: z.coerce.number().int().nonnegative().default(0),
  // Reject a public POST with 503 when today's total run-count exceeds this
  // (hard cap; the soft warn is COST_DAILY_WARN).
  COST_DAILY_CAP: z.coerce.number().int().nonnegative().default(0),
  // Cloudflare Turnstile secret — when set, the public POST routes require a
  // valid Turnstile token. Empty (default) ⇒ Turnstile is off.
  TURNSTILE_SECRET: z.string().optional(),
})

export type EnvSchema = z.infer<typeof envSchema>
