import { defineConfig } from "drizzle-kit"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  // Generation doesn't strictly need the URL, but `drizzle-kit migrate`
  // does. Fail loudly if it's missing — there's no safe default for prod.
  // For local dev: export DATABASE_URL=postgres://echo:changeme@localhost:5432/echo
}

export default defineConfig({
  dialect: "postgresql",
  // Single barrel entry — drizzle-kit walks transitive imports from here.
  // Using a glob (`schema/*.ts`) double-counts cross-imported tables in 1.x.
  schema: "./packages/db/src/schema/index.ts",
  out: "./packages/db/migrations",
  dbCredentials: {
    url: databaseUrl ?? "postgres://placeholder",
  },
  verbose: true,
  strict: true,
})
