import { randomUUID } from "node:crypto"
import type { Params } from "nestjs-pino"

export interface LoggerConfigInput {
  nodeEnv: "development" | "test" | "production"
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal"
}

/**
 * Build the nestjs-pino params used by both `apps/api` and `apps/worker`.
 *
 * - JSON output in production (parseable by Loki / CloudWatch / Datadog)
 * - pino-pretty in development (human-readable, colourised)
 * - Stable level names (`{ level: "info" }` instead of pino's default
 *   numeric `30`) so log queries are intuitive
 * - `x-request-id` is honoured if upstream sent one; otherwise we mint
 *   a UUID per request — the same id appears on every log line for that
 *   request and propagates into worker job options in P4
 */
export function buildLoggerConfig(input: LoggerConfigInput): Params {
  const isDev = input.nodeEnv === "development"

  return {
    pinoHttp: {
      level: input.logLevel,
      formatters: {
        level: (label) => ({ level: label }),
      },
      genReqId: (req) => {
        const incoming = req.headers["x-request-id"]
        if (typeof incoming === "string" && incoming.length > 0) return incoming
        return randomUUID()
      },
      transport: isDev
        ? {
            target: "pino-pretty",
            options: {
              singleLine: true,
              translateTime: "SYS:HH:MM:ss.l",
              ignore: "pid,hostname",
            },
          }
        : undefined,
      // Trim noisy automatic fields
      autoLogging: {
        ignore: (req) => {
          const url = (req as { url?: string }).url ?? ""
          // Don't log every healthcheck or metrics scrape
          return url.startsWith("/api/health/") || url === "/api/metrics"
        },
      },
    },
  }
}
