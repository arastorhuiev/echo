// TODO: extract to shared @echo/nest package later (also in apps/api).
/** DI token for the singleton ioredis client used by the cache wrapper (and by health checks in api). */
export const REDIS = Symbol.for("@echo/api/REDIS")
