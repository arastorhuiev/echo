import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["test/**/*.int.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
})
