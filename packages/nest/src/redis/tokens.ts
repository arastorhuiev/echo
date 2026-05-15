/** DI token for the singleton ioredis client used by health checks + the cache wrapper. */
export const REDIS = Symbol("@echo/nest/REDIS")
