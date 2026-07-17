/**
 * Unit-test env shim. Many unit tests import Nest providers via the
 * `@echo/providers` barrel, which transitively evaluates every provider
 * module's `import { ConfigModule } from "@echo/config"`. `ConfigModule`
 * is `NestConfigModule.forRoot({ validate: envSchema.parse })`, which
 * validates `process.env` at load time — so without the required vars it
 * throws a ZodError (an async unhandled rejection that fails the run on
 * CI, where no `.env` is present).
 *
 * These dummy values only satisfy the schema; unit tests never connect to
 * anything. Real values come from `.env` / the environment at runtime, and
 * the integration tests (vitest.int.config.ts) get theirs from
 * Testcontainers. `??=` so a real environment/value always wins.
 */
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test"
process.env.REDIS_URL ??= "redis://localhost:6379"
process.env.OSINT_PY_URL ??= "http://localhost:8000"
process.env.ADMIN_TOKEN ??= "test-admin-token"
