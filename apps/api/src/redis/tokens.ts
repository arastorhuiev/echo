/** DI token for the singleton ioredis client used by health checks (and BullMQ from P4). */
export const REDIS = Symbol.for("@echo/api/REDIS")
