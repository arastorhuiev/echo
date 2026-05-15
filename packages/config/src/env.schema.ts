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
})

export type EnvSchema = z.infer<typeof envSchema>
