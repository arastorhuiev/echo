import { defineConfig } from "vitest/config"

export default defineConfig({
  // Vitest 4 / Vite 7 native tsconfig paths resolution — replaces the
  // deprecated vite-tsconfig-paths plugin. Reads `paths` from the closest
  // tsconfig.json relative to the running config file.
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["test/**/*.int.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
})
