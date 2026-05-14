import { type INestApplication } from "@nestjs/common"
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"
import { cleanupOpenApiDoc } from "nestjs-zod"

/**
 * Wires `@nestjs/swagger` so that Zod-defined DTOs (via `nestjs-zod`)
 * appear correctly in the generated OpenAPI document.
 *
 * - `/api/openapi.json` -> machine-readable spec
 * - `/api/docs`         -> Swagger UI
 *
 * `nestjs-zod` v5 dropped the old `patchNestjsSwagger()` global patch in
 * favour of `cleanupOpenApiDoc(doc)` applied after document creation.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle("echo API")
    .setDescription("OSINT aggregator backend")
    .setVersion("0.0.0")
    .build()

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config))

  SwaggerModule.setup("api/docs", app, document, {
    jsonDocumentUrl: "api/openapi.json",
  })
}
