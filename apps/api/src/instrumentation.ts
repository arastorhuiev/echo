import { startInstrumentation } from "@echo/observability/instrumentation"

startInstrumentation({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "echo-api",
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
})
