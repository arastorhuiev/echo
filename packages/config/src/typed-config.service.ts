import type { ConfigService } from "@nestjs/config"
import type { EnvSchema } from "@/env.schema.js"

/**
 * Strongly-typed alias for `ConfigService<EnvSchema, true>`.
 *
 * Inject as: `constructor(private readonly config: AppConfigService) {}`.
 * The second generic (`true`) tells `@nestjs/config` that lookups always
 * return non-undefined values for known keys — true for us because
 * envSchema.parse guarantees every key is present (or has a default).
 */
export type AppConfigService = ConfigService<EnvSchema, true>
