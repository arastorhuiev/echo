// TODO: extract to shared @echo/nest package later (also in apps/api).
/** DI token for the singleton @echo/db client (db + sql + close + ping). */
export const DB_CLIENT = Symbol.for("@echo/api/DB_CLIENT")
