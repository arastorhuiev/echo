import { ConfigModule as NestConfigModule } from "@nestjs/config"
import { envSchema } from "@/env.schema.js"

/**
 * Pre-configured global NestJS ConfigModule:
 * - validates `process.env` against `envSchema` at startup (fail-fast)
 * - caches the result so `ConfigService.get` is a hot path
 * - is global, so any module in the app graph can `inject: [ConfigService]`
 *
 * Usage: `@Module({ imports: [ConfigModule] })` in the app's root module.
 */
export const ConfigModule = NestConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: (raw) => envSchema.parse(raw),
})
