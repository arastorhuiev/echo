import "@/instrumentation"
import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { Logger } from "nestjs-pino"
import { AppModule } from "@/app.module"

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  })
  app.useLogger(app.get(Logger))
  app.enableShutdownHooks()

  const logger = app.get(Logger)
  logger.log("Worker context started — no jobs registered yet (P4 wires BullMQ consumers)")

  // Keep the Node event loop alive until SIGTERM/SIGINT. NestJS's
  // `enableShutdownHooks()` listens for both signals and unwinds providers
  // gracefully. A pending `setInterval` is the simplest event-loop reference
  // that survives Node 24's stricter idle-exit behaviour. Once BullMQ
  // consumers are registered (P4), they own the keep-alive instead.
  setInterval(() => {}, 1 << 30)
}

bootstrap().catch((err) => {
  console.error("Fatal: Worker bootstrap failed", err)
  process.exit(1)
})
