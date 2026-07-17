// Re-export the prom-client primitives so app-side collectors register
// custom metrics on MetricsService.registry without depending on prom-client
// directly (it stays a single centralized dependency here).
export { Counter, Gauge, Histogram } from "prom-client"
export { type InstrumentationOptions, startInstrumentation } from "@/instrumentation.js"
export { buildLoggerConfig, type LoggerConfigInput } from "@/logger.config.js"
export { MetricsModule } from "@/metrics.module.js"
export { MetricsService } from "@/metrics.service.js"
