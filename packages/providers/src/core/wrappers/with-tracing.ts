import { SpanStatusCode, trace } from "@opentelemetry/api"
import type { OsintProvider } from "@/core/provider.js"

const tracer = trace.getTracer("@echo/providers")

/**
 * Wraps `provider.run()` in an OpenTelemetry span. Span name is
 * `provider.<id>`; standard attributes include provider.id,
 * provider.category, and lookup.id. Errors are recorded and the span
 * is given ERROR status before re-throwing.
 */
export function withTracing<Q, R>(provider: OsintProvider<Q, R>): OsintProvider<Q, R> {
  return {
    ...provider,
    async *run(query, ctx) {
      const span = tracer.startSpan(`provider.${provider.id}`, {
        attributes: {
          "provider.id": provider.id,
          "provider.category": provider.category,
          "lookup.id": ctx.lookupId,
        },
      })
      try {
        yield* provider.run(query, ctx)
        span.setStatus({ code: SpanStatusCode.OK })
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        })
        if (err instanceof Error) span.recordException(err)
        throw err
      } finally {
        span.end()
      }
    },
  }
}
