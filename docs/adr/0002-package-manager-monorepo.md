# 0002. Package manager and monorepo layout — pnpm workspaces

**Status:** Accepted
**Date:** 2026-05-14

## Context

`echo` will be a monorepo with two apps (`api`, `worker`), one Python sidecar (`services/echo-osint-py`), and many shared packages (`@echo/db`, `@echo/providers`, `@echo/contracts`, …). Solo maintainer wants fast installs and minimal monorepo tooling overhead.

## Decision

- **Package manager:** pnpm 10.
- **Layout:** pnpm workspaces. `pnpm-workspace.yaml` declares `apps/*`, `packages/*`, `services/*`.
- **No Turborepo or Nx for now.** `pnpm -r run build` and `pnpm -F <pkg>` filters are sufficient at this scale.
- Lockfile (`pnpm-lock.yaml`) is committed; npm and yarn lockfiles are gitignored to prevent accidental cross-tool drift.

## Consequences

**Good:**
- Content-addressable store → fast installs and tiny `node_modules` footprint.
- Strict by default: no phantom dependencies. Forces honest `package.json` declarations.
- Workspace filters (`pnpm -F @echo/api dev`) are clean and predictable.
- Compatible with NestJS, Drizzle, Vitest, Biome out of the box.

**Bad:**
- Some Node tools (older ones) assume a flat `node_modules`; rare but happens — fix with `public-hoist-pattern` if needed.
- New contributors may need a 5-minute primer on `pnpm` vs `npm`.

## Alternatives considered

- **npm workspaces** — slower installs, no content-addressable store, weaker hoisting controls.
- **Yarn berry (PnP)** — Plug'n'Play breaks too many tools; classic mode is no better than pnpm.
- **Nx** — premature; great when you have many teams or many apps with complex graph dependencies.
- **Turborepo** — useful for cache; we'll add later if `pnpm -r run` becomes slow.

## Triggers to reconsider

- Build times exceed ~30 seconds locally → introduce Turborepo for incremental builds and remote cache.
- Multiple contributors needing strict task graph → introduce Nx or Turborepo.
