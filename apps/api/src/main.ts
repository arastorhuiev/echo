import "@/instrumentation"
import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Logger } from "nestjs-pino"
import { AppModule } from "@/app.module"
import { setupOpenApi } from "@/openapi"

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  })
  app.useLogger(app.get(Logger))
  app.setGlobalPrefix("api")
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
