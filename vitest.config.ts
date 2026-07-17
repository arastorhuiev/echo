import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Set required env vars before any test module (and its transitive
    // @echo/config ConfigModule.forRoot validation) evaluates. Keeps unit
    // tests hermetic — green on CI where no .env exists.
    setupFiles: ["./test/vitest-setup-env.ts"],
    // ADR-0013: tests are co-located in src/ next to the code they exercise.
    // The legacy `test/` location is also accepted for shared helpers /
    // fixture-heavy suites. Default `pnpm test` is unit-only — integration
    // tests carry the `.int.test.ts` suffix and run via per-package
    // vitest.int.config.ts (see `pnpm test:int`).
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.int.test.ts"],
    reporters: process.env.CI ? ["default", "github-actions"] : ["default"],
  },
})
