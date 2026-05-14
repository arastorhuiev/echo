# 0010. Rate limiting without auth

**Status:** Accepted
**Date:** 2026-05-14

## Context

Phase 1 of `echo` is **anonymous public** — no authentication ([0012](./0012-no-auth-no-payments-phase1.md)). A demo link could go viral; a single abuser could exhaust upstream quotas; a buggy script could DDoS our own infrastructure. We need defense in depth that works without user identity, while staying cheap and simple to operate solo.

## Decision

Layered rate limiting and abuse control, applied from edge inward:

1. **Cloudflare** (free tier): Bot Fight Mode, IP reputation block list, basic WAF.
2. **Caddy** (reverse proxy on the VPS): per-IP burst limit (`30 req/min`) and a global RPS ceiling. Rejects overflow with 429 before requests touch NestJS.
3. **`@nestjs/throttler`** (in the API, Redis-backed): per-IP rate on `/api/lookups` (e.g., `10 lookups/hr/IP`). Distinct from edge limits — edge protects against floods, app limits enforce policy.
4. **Per-provider concurrency cap** (BullMQ queue concurrency = `provider.defaults.maxConcurrent`). One user spamming Sherlock can't starve Holehe.
5. **Per-provider circuit breaker** ([0005](./0005-osint-provider-abstraction.md), `withBreaker`). Opens after N consecutive 429/5xx from upstream; surfaced as `503 Service Unavailable` until reset window passes. Persisted to Postgres `providers` table so worker restarts don't lose state.
6. **Backpressure at the API**: when `bullQueue.<providerId>.waitingCount > N`, `POST /api/lookups` returns `503 Retry-After: 30`. Better than silently queueing forever.
7. **Cost guard**: per-provider daily counter in Redis (`cost:<provider>:<YYYYMMDD>`); when count exceeds env-configured threshold, stop accepting new jobs and alert.
8. **Cloudflare Turnstile** (free CAPTCHA): when a single IP hits 80% of its hourly limit, require a Turnstile token on the next request. Scaffolding only in Phase 1; activated when abuse is observed.

All 429/503 responses include `Retry-After` and a `X-RateLimit-*` header set so clients can backoff intelligently.

## Consequences

**Good:**
- Defense in depth: an abuser must defeat *every* layer to cause damage.
- Cost guard caps blast radius if an upstream API has unexpected per-call billing.
- No layer requires user identity — works in Phase 1, doesn't need re-architecture in Phase 3.
- Each layer is independently observable (Caddy logs, Cloudflare analytics, NestJS metrics).

**Bad:**
- Per-IP limits are weak against rotating-IP abusers (proxies, mobile NAT). The cost guard and per-provider concurrency are the real protection there.
- Turnstile adds friction; we hold it back as a "break glass" rather than always-on.
- Operational complexity: more knobs to tune, more dashboards to watch.

## Alternatives considered

- **Rely on edge / Cloudflare only.** Insufficient — no per-provider awareness, no cost guard.
- **Require auth in Phase 1.** Contradicts product direction; defers the launch.
- **Single global token bucket.** Simpler, but a single noisy user starves everyone.

## Triggers to reconsider

- Sustained abuse from rotating IPs → require auth ([0012](./0012-no-auth-no-payments-phase1.md) trigger) or shift to compute-bound proof-of-work challenge.
- Specific upstream API repeatedly exhausts our quota despite breaker → reduce that provider's `maxConcurrent` or move to a paid tier with higher limits.
- Legitimate users hitting limits → tune up.
