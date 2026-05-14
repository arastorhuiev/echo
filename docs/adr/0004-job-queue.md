# 0004. Job queue — BullMQ on Redis

**Status:** Accepted
**Date:** 2026-05-14

## Context

Many OSINT lookups take seconds to minutes. The API must accept a request, return immediately, and let a background worker do the heavy lifting. We need durability across restarts, per-queue concurrency limits, retries with backoff, and observable queue depth for backpressure decisions.

## Decision

- **Queue library:** BullMQ 5.
- **Broker:** Redis 7 (the same Redis instance also serves as cache and as the SSE event bus).
- **NestJS integration:** `@nestjs/bullmq`.
- **One queue per provider:** `q.<providerId>`. Concurrency, retry policy, and backoff configured from the provider's `defaults`.
- **Dead-letter pattern:** on `failed` after max attempts, append a `_tag: "Failed"` event to `lookup_events` and mark `lookups.status = failed` with `error_kind`/`error_message`.
- **Trace context propagation:** OpenTelemetry trace state is attached to every job's `opts.repeat` / metadata so the worker span continues the API span.

## Consequences

**Good:**
- Battle-tested; Redis is already a dependency.
- Per-queue concurrency naturally enforces per-provider rate limits — one slow provider can't starve another.
- Standard Bull patterns (events, repeatable jobs, delayed jobs) buy us provider health probes and scheduled cache eviction for free.
- `@nestjs/bullmq` integrates cleanly with Nest DI and lifecycle.

**Bad:**
- Redis becomes critical infrastructure — its loss halts work intake and SSE replay.
- BullMQ doesn't natively model long-running workflows (lookup → enrich → re-lookup); for those we'd graduate to Effect Cluster or Temporal.
- Queue introspection requires Redis CLI or a separate UI (e.g., Bull Board) — we'll add Bull Board only if needed.

## Alternatives considered

- **In-memory queue** — loses jobs on restart; only fits dev mocks.
- **Agenda** — MongoDB dependency we don't want.
- **Effect Cluster** — premature given [0006](./0006-effect-ts-deferred.md); revisit if Effect adoption proceeds.
- **Temporal** — heavy ops surface; great when workflows need first-class state machines.
- **PostgreSQL-as-a-queue (`pg-boss`, SKIP LOCKED)** — viable, but we already have Redis; one-broker-per-concern is simpler.

## Triggers to reconsider

- Workflow-shaped jobs appear (multi-step orchestration, compensation, manual intervention) → consider Temporal or Effect Cluster.
- Redis becomes a scaling bottleneck → split: Redis for cache + Redis for BullMQ + Redis for SSE.
- We need cross-cluster job replication.
