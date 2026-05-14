import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { NodeSDK } from "@opentelemetry/sdk-node"

export interface InstrumentationOptions {
  /** Reported as `service.name` on every span. */
  serviceName: string
  /** OTLP/HTTP collector base URL (e.g. http://otel-collector:4318). */
  otlpEndpoint?: string | undefined
}

/**
 * Initialise OpenTelemetry. MUST be called before any application code that
 * the SDK is supposed to instrument (HTTP servers, DB clients, etc.) —
 * conventionally from a `instrumentation.ts` file imported as the first
 * thing in `main.ts`.
 *
 * Without an OTLP endpoint, the SDK still wires auto-instrumentations
 * (so spans are produced), but no exporter is attached — useful in dev to
 * measure overhead without sending traces anywhere.
 */
export function startInstrumentation(options: InstrumentationOptions): NodeSDK {
  const traceExporter = options.otlpEndpoint
    ? new OTLPTraceExporter({ url: `${options.otlpEndpoint.replace(/\/+$/, "")}/v1/traces` })
    : undefined

  const sdk = new NodeSDK({
    serviceName: options.serviceName,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem spans are extremely noisy and rarely useful.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  })

  sdk.start()

  const shutdown = async (): Promise<void> => {
    try {
      await sdk.shutdown()
    } catch (err) {
      console.error("OpenTelemetry shutdown failed", err)
    }
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  return sdk
}
