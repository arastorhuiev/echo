import "@/instrumentation"
import "reflect-metadata"
import { applyMigrations } from "@echo/db"
import { NestFactory } from "@nestjs/core"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Logger } from "nestjs-pino"
import { ZodValidationPipe } from "nestjs-zod"
import { AppModule } from "@/app.module"
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
  // Auto-validates every @Body()/@Param()/@Query() parameter typed as a
  // `createZodDto`-derived class. Malformed payloads return a structured
  // 400 instead of bubbling up as deep-stack TypeErrors.
  app.useGlobalPipes(new ZodValidationPipe())
  app.enableShutdownHooks()
  setupOpenApi(app)

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port, "0.0.0.0")

  app.get(Logger).log(`API listening on http://0.0.0.0:${port}/api`)
}

bootstrap().catch((err) => {
  console.error("Fatal: API bootstrap failed", err)
  process.exit(1)
})
