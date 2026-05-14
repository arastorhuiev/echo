import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const here = fileURLToPath(new URL(".", import.meta.url))
const migrationsFolder = resolve(here, "..", "migrations")

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("DATABASE_URL is required")
    process.exit(2)
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} })
  const db = drizzle({ client: sql })

  console.log(`Applying migrations from ${migrationsFolder}`)
  await migrate(db, { migrationsFolder })
  await sql.end({ timeout: 5 })
  console.log("Migrations applied")
}

main().catch((err: unknown) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
