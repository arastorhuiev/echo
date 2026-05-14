import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // Integration tests have their own per-package config (`vitest.int.config.ts`)
    // and run via `pnpm -r run test:int`. Default `pnpm test` is unit-only.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.int.test.ts"],
    reporters: process.env.CI ? ["default", "github-actions"] : ["default"],
  },
})
