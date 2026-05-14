# 0013. Code organization conventions

**Status:** Accepted
**Date:** 2026-05-14

## Context

As echo grows beyond a handful of files (apps/api alone now has health, db, redis, metrics modules), we need consistent rules for where source, tests, types, and helpers live. Pinning the convention now avoids large reorganisation later.

## Decision

### File organisation — feature folders + co-located everything

Group files by **feature**, not by **type**. Within a feature folder, put module + controllers + services + indicators + types + tests next to each other.

```
src/health/
  health.module.ts
  health.controller.ts
  health.controller.test.ts            ← unit test, co-located
  health.controller.int.test.ts        ← integration test, co-located
  postgres.health-indicator.ts
  postgres.health-indicator.test.ts
  redis.health-indicator.ts
  redis.health-indicator.test.ts
  sidecar.health-indicator.ts
  sidecar.health-indicator.test.ts
  health.types.ts                      ← only when shared inside the folder
```

For trivial features (≤ 2 related files) flat `src/` is acceptable — promote to a folder when the count grows.

### Tests

| Kind | Suffix | Where | How to run |
|---|---|---|---|
| Unit | `*.test.ts` | Co-located next to the code | `pnpm test` (default) |
| Integration | `*.int.test.ts` | Co-located next to the code | `pnpm test:int` (per-package) |
| Shared helpers | — | `test/helpers/*.ts`, imported as `@test/helpers/...` | (utility) |
| Suite-wide setup | — | `test/global-setup.ts` (vitest globalSetup) | (lifecycle) |

The default `pnpm test` runner excludes `**/*.int.test.ts` so the fast loop stays fast and offline.

For integration suites that need expensive shared resources (Testcontainers etc.), use vitest's `globalSetup` to spin up once and write connection strings to env vars; per-file `beforeAll` connects.

### Types and interfaces

- **Define types/interfaces in the SAME file as the code that uses them** (default).
- **Promote to `*.types.ts` ONLY when 2+ files in the same feature folder need the type.**
- Don't have parallel `*.interface.ts` and `*.types.ts` files — TypeScript doesn't distinguish them at the call site, separate files only adds noise.
- Schema-derived types (Drizzle's `$inferSelect`, Zod's `z.infer<typeof ...>`) live with their schema definitions.

### Imports

- **Intra-package**: per-package `@/*` alias mapped to `./src/*`. For packages that have shared test helpers, also `@test/*` mapped to `./test/*`.
- **Cross-package**: workspace package names (`@echo/db`, `@echo/config`, `@echo/observability`).
- **Never** use relative `../../` paths that span more than one directory.
- Imports must include `.js` extensions for ESM packages — see [ADR-0014](./0014-js-suffixes-in-ts-imports.md).

## Consequences

**Good:**
- "Where do I find X?" has one answer (the feature folder).
- Deleting or moving a feature is mechanical — one folder.
- Aligns with NestJS docs and the dominant TS-project standard.
- Test failures point at the same folder as the code.

**Bad:**
- Test files mixed with source files in the same directory (mitigated by `.test.ts` / `.int.test.ts` suffixes + tsconfig exclude rules).
- Initial migration cost (small — current codebase is young).

## Alternatives considered

- **Mirror `test/` directory** — cleaner `src/` but double-navigation, files drift apart on rename.
- **Sibling files (`feature.test.ts`, `feature.types.ts`, `feature.interface.ts`)** — too many tiny files; `interface` vs `type` separation is not idiomatic TypeScript.
- **Test/type files at package root** — doesn't scale past a handful of features.

## Triggers to reconsider

- Test files in `src/` make build/dist exclusion painful (some weird tooling that doesn't honour `*.test.ts` exclude).
- A pattern emerges that doesn't fit feature folders (e.g., truly cross-cutting utilities — those go into `packages/*` instead).
