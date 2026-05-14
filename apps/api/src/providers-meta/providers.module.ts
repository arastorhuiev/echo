import { Module } from "@nestjs/common"
import { ProvidersController } from "@/providers-meta/providers.controller"

/**
 * GET /api/providers — exposes the OsintProviderRegistry contents.
 * The registry itself is provided globally by OsintProviderRegistryModule
 * in AppModule, so no explicit import here.
 */
@Module({
  controllers: [ProvidersController],
})
export class ProvidersModule {}
