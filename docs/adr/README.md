# Architecture Decision Records

This directory contains every load-bearing decision made for **echo**, in the standard Markdown ADR format. Decisions are numbered, immutable once accepted, and superseded (not edited) when reversed.

## Index

| #    | Title                                                                                          | Status   |
|------|------------------------------------------------------------------------------------------------|----------|
| 0001 | [Language and framework — TypeScript + NestJS](./0001-language-and-framework.md)               | Accepted |
| 0002 | [Package manager and monorepo layout — pnpm workspaces](./0002-package-manager-monorepo.md)    | Accepted |
| 0003 | [Database and ORM — PostgreSQL + Drizzle](./0003-database-orm.md)                              | Accepted |
| 0004 | [Job queue — BullMQ on Redis](./0004-job-queue.md)                                             | Accepted |
| 0005 | [OSINT provider abstraction](./0005-osint-provider-abstraction.md)                             | Accepted |
| 0006 | [Effect-TS deferred](./0006-effect-ts-deferred.md)                                             | Accepted |
| 0007 | [Real-time progress — Server-Sent Events](./0007-realtime-progress.md)                         | Accepted |
| 0008 | [Python OSINT sidecar](./0008-python-osint-sidecar.md)                                         | Accepted |
| 0009 | [Cache strategy — multi-tier with single-flight](./0009-cache-strategy.md)                     | Accepted |
| 0010 | [Rate limiting without auth](./0010-rate-limiting-without-auth.md)                             | Accepted |
| 0011 | [Deployment target — Hetzner CCX](./0011-deployment-target.md)                                 | Accepted |
| 0012 | [No auth or payments in Phase 1; schema reservations](./0012-no-auth-no-payments-phase1.md)    | Accepted |
| 0013 | [Code organization conventions](./0013-code-organization.md)                                   | Accepted |
| 0014 | [`.js` suffixes in TypeScript imports for NodeNext ESM](./0014-js-suffixes-in-ts-imports.md)   | Accepted |

## Format

Each ADR uses this structure (a trimmed [MADR](https://adr.github.io/madr/)):

```markdown
# NNNN. <Title>

**Status:** Proposed | Accepted | Deprecated | Superseded by [NNNN](./NNNN-...)
**Date:** YYYY-MM-DD

## Context
What is the situation that requires a decision?

## Decision
What we chose, in active voice.

## Consequences
What does this make easy / hard? What follow-up choices does this force?

## Alternatives considered
Briefly: what else was on the table and why we rejected it.

## Triggers to reconsider
Concrete conditions that should make us re-open this ADR.
```

## Writing a new ADR

1. Pick the next number.
2. Copy this format. Be brief — ADRs are not essays. 30–80 lines is normal.
3. Link related ADRs.
4. Add to the table above.
5. Reference the ADR from `ARCHITECTURE.md` if it constrains the architecture.
6. Once merged, **don't edit** — supersede with a new ADR if the decision changes.
