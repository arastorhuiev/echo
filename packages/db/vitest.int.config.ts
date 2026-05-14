import { defineConfig } from "vitest/config"

export default defineConfig({
  // Vitest 4 / Vite 7 native tsconfig paths resolution — replaces the
  // deprecated vite-tsconfig-paths plugin. Reads `paths` from the closest
  // tsconfig.json (which exposes both `@/*` -> src and `@test/*` -> test).
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Co-located integration tests live next to the code they exercise.
    include: ["src/**/*.int.test.ts"],
    // One Postgres container per suite (not per file) — see test/global-setup.ts
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
})
