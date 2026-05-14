# 0009. Cache strategy — multi-tier with single-flight

**Status:** Accepted
**Date:** 2026-05-14

## Context

OSINT lookups are expensive (seconds–minutes), often hit external rate-limited APIs, and have a high duplicate rate (the same username, the same domain, queried by many users). We need to (a) avoid repeating recent lookups, (b) collapse concurrent identical requests into a single upstream call (cache stampede protection), and (c) keep cache logic out of every provider implementation.

## Decision

Three-tier cache with a Redis-based single-flight lock:

| Layer | Storage              | TTL                              | Purpose                                       |
|-------|----------------------|----------------------------------|-----------------------------------------------|
| L1    | In-process LRU       | 10 s                             | Hot lookup IDs (avoids repeat Redis hits)     |
| L2    | Redis                | per-provider (1 h – 7 d)         | Result cache, key `cache:result:<id>:<hash>`  |
| L3    | HTTP `Cache-Control` | derived from L2 TTL              | Edge / browser cache for completed `GET /api/lookups/:id` |
| Lock  | Redis `SET NX PX`    | 30 s                             | Single-flight: `lock:lookup:<queryHash>`      |
| Stream| Redis Streams        | 1 h after Final                  | SSE event replay: `lookup:events:<id>`        |

Cache key construction:
- `queryHash = sha256(canonicalize(query))`. Canonicalization: sort object keys, normalize whitespace, lowercase emails / usernames / domains where the provider treats them as case-insensitive.
- Provider can override canonicalization if needed via `provider.canonicalize?: (q) => q`.

Single-flight flow (in `withSingleFlight` wrapper, [0005](./0005-osint-provider-abstraction.md)):
1. Check L1, then L2 — return on hit.
2. Try `SET NX PX 30000 lock:lookup:<hash>`.
3. If acquired: enqueue BullMQ job; subscribe to `lookup:done:<hash>` channel; on completion, write cache + publish.
4. If not acquired: subscribe to `lookup:done:<hash>`; wait up to lock TTL; on publish, return the same result.

All cache writes happen atomically with the `lookups.status = done` transition.

## Consequences

**Good:**
- Stampede protection from day one — a viral demo link doesn't fan out to 1000 upstream calls.
- Per-provider TTLs respect upstream freshness (Sherlock: 24h, phone lookups: 7d, breach data: shorter).
- Cache logic is one wrapper, not 12.
- L1 saves Redis round-trips on hot lookups (`/api/lookups/:id` polls, etc.).

**Bad:**
- L1 + L2 introduces consistency windows (~10 s); acceptable for OSINT, would be wrong for transactional data.
- Wrong canonicalization means cache misses or, worse, false hits. Mitigation: per-provider canonicalization tested in conformance suite.
- Lock TTL must be > P99 lookup duration, or the second waiter will run a duplicate. Mitigation: long-running providers extend the lock periodically.

## Alternatives considered

- **No cache.** Wastes upstream quota; punishes repeat queries.
- **Single Redis tier only.** Loses the cheap L1 wins for repeat HTTP polls.
- **In-process cache only.** Doesn't help across worker processes.
- **Probabilistic cache (e.g., write-through with bloom filters).** Premature; vanilla TTL cache works fine until it doesn't.

## Triggers to reconsider

- Cache hit ratio < 30% sustained → reconsider TTLs and key normalization.
- Lock TTL extension logic becomes a source of bugs → consider a fencing-token approach (Redlock alternative).
- Cross-region replication needed → reconsider Redis topology.
