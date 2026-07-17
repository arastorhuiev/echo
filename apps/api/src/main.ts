import "@/instrumentation"
import "reflect-metadata"
import { applyMigrations } from "@echo/db"
import { ConfigService } from "@nestjs/config"
import { NestFactory } from "@nestjs/core"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import type { FastifyInstance } from "fastify"
import { Logger } from "nestjs-pino"
import { ZodValidationPipe } from "nestjs-zod"
import { mountBullBoard } from "@/admin/bull-board"
import { AppModule } from "@/app.module"
import { QueueRouter } from "@/lookups/queue-router"
import { setupOpenApi } from "@/openapi"

async function bootstrap(): Promise<void> {
  // Apply pending migrations before the HTTP server starts. Idempotent —
  // Drizzle tracks applied migrations in a metadata table. Failing here
  // is a hard exit so the api never serves traffic against a stale schema.
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is required at api boot")
  await applyMigrations(databaseUrl)

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  })
  app.useLogger(app.get(Logger))
  app.setGlobalPrefix("api")
  // Allow the Astro dev frontend (apps/web, defaults to :4321) and any
  // sibling tooling on localhost to call /api from the browser. In
  // production a reverse proxy will serve same-origin so this stays a
  // dev-time convenience.
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      try {
        const host = new URL(origin).hostname
        cb(null, host === "localhost" || host === "127.0.0.1")
      } catch {
        cb(null, false)
      }
    },
    credentials: false,
  })
  // Auto-validates every @Body()/@Param()/@Query() parameter typed as a
  // `createZodDto`-derived class. Malformed payloads return a structured
  // 400 instead of bubbling up as deep-stack TypeErrors.
  app.useGlobalPipes(new ZodValidationPipe())
  app.enableShutdownHooks()
  setupOpenApi(app)

  // Mount Bull-Board on the raw Fastify instance (P13). init() first so the
  // QueueRouter has built its per-provider queues; a failed mount logs but
  // must not stop the API from serving (the dashboard is an ops extra).
  await app.init()
  try {
    const fastify = app.getHttpAdapter().getInstance() as FastifyInstance
    const queues = app.get(QueueRouter).all()
    // Use the zod-validated token (non-empty guaranteed), never raw env —
    // an empty token would make basicAuthValid("", "") accept any password.
    const adminToken = app.get(ConfigService).getOrThrow<string>("ADMIN_TOKEN")
    await mountBullBoard(fastify, queues, adminToken)
    app.get(Logger).log("Bull-Board mounted at /admin/queues")
  } catch (err) {
    app
      .get(Logger)
      .error(`Bull-Board mount failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port, "0.0.0.0")

  app.get(Logger).log(`API listening on http://0.0.0.0:${port}/api`)
}

bootstrap().catch((err) => {
  console.error("Fatal: API bootstrap failed", err)
  process.exit(1)
})
