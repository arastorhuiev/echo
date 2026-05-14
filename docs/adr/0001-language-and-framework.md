# 0001. Language and framework — TypeScript + NestJS

**Status:** Accepted
**Date:** 2026-05-14

## Context

`echo` is a backend service that aggregates many independent OSINT tools, exposes a single HTTP API, and must remain extensible and readable as the integration count grows. The maintainer is solo, prefers a structured framework, and wants the system to remain approachable months later. The original PROMPT.md named NestJS as the preferred stack; ANSWERS.md confirmed this preference and downgraded the original "Effect-TS aggressively" goal to "add later if needed" (see [0006](./0006-effect-ts-deferred.md)).

## Decision

- **Language:** TypeScript 6.x with `strict: true`, `noUncheckedIndexedAccess: true`, and `verbatimModuleSyntax: true`.
- **Runtime:** Node.js 24 LTS (latest LTS line as of 2026-05).
- **Framework:** NestJS 11 with the Fastify adapter (`@nestjs/platform-fastify`).
- **Validation:** Zod via `nestjs-zod` — Zod beats `class-validator` for ergonomics, share-with-Drizzle potential, and editor support.
- **HTTP server engine:** Fastify under Nest, not Express — faster, smaller, identical Nest API surface.

## Consequences

**Good:**
- Conventional, well-documented framework — easy to onboard contributors and easy for an executor agent to follow established patterns.
- DI, lifecycle hooks, decorators, and module boundaries come built-in.
- Huge ecosystem (`@nestjs/bullmq`, `@nestjs/throttler`, `@nestjs/terminus`, `@nestjs/swagger`, `nestjs-pino`) covers most cross-cutting concerns.
- OpenAPI generation is first-party.

**Bad:**
- Lock-in to Nest abstractions (modules, providers, decorators).
- Vitest needs an SWC adapter (`unplugin-swc`) to play nicely with Nest's reflect-metadata. Documented in [P0/P3 of the agent plan](../AGENT_PLAN.md).
- Nest's Express-shaped reflexes occasionally bleed through even with the Fastify adapter; we'll prefer Fastify-native middleware where it matters (e.g., SSE streaming).

## Alternatives considered

- **Pure Effect-TS (`@effect/platform-node`)** — rejected; user prefers NestJS as the readable base. See [0006](./0006-effect-ts-deferred.md).
- **Express** — too bare; we'd reinvent half of NestJS.
- **Hono** — minimal and modern but lacks the structured DI / lifecycle that we want for a many-providers system.
- **Elysia / Bun** — Bun lock-in, smaller ecosystem, less mature OSINT-tooling Node bindings.
- **NestJS with Express** — Fastify is a free perf win.

## Triggers to reconsider

- Provider count exceeds ~30 *and* per-provider service-level scaling becomes a bottleneck → consider splitting into Plan-C-style microservices.
- Effect-TS adoption ([0006](./0006-effect-ts-deferred.md)) creates persistent friction with Nest DI → reconsider HTTP framework.
- Fastify adapter becomes a NestJS deprecation target.
