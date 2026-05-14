# Plan C — Event-Driven Service Mesh

> **One sentence:** Each OSINT provider is its own service container subscribing to a topic on a message bus; the API gateway is thin and the system grows by adding services, not by editing a registry.

## When this is the right answer

- You already know you'll have ≥10 providers, in multiple languages (Python, Go, Rust, Node).
- You have at least one teammate who can own ops.
- You expect bursty workloads where some providers must scale 100× while others sit idle.
- You're OK with a 6–10 week MVP and meaningful infra learning curve.

If you can't say yes to all four, **start with Plan B** and graduate later. The migration path is short.

## Architecture

```
        ┌────────────────────────────────────────────────┐
        │   Cloudflare (DNS, edge cache, WAF)            │
        └──────────────┬─────────────────────────────────┘
                       │
                ┌──────▼───────┐
                │   Astro+SK   │
                │  (Pages)     │
                └──────┬───────┘
                       │ HTTPS / WS
                       ▼
              ┌──────────────────┐
              │  API Gateway     │   NestJS, thin
              │  (BFF)           │   - Auth, quotas, billing
              │                  │   - Publishes "lookup.requested"
              │                  │   - Bridges WS ↔ topic subscribe
              └──────┬───────────┘
                     │ publish/subscribe
                     ▼
   ┌─────────────────────────────────────────────────────┐
   │   Message bus: NATS JetStream (recommended)         │
   │     subjects: lookup.requested.<provider>           │
   │               lookup.event.<lookupId>               │
   │               lookup.result.<lookupId>              │
   │   + KV store for in-flight state                    │
   └─┬───────┬────────┬──────────┬─────────────┬─────────┘
     │       │        │          │             │
     ▼       ▼        ▼          ▼             ▼
  ┌────┐ ┌────────┐ ┌──────┐ ┌──────────┐ ┌──────────┐
  │sherl│ │getcon  │ │whois│ │shodan-svc│ │  …       │
  │ock  │ │tact    │ │-svc │ │          │ │          │
  │-svc │ │-svc    │ │     │ │          │ │          │
  │(Py) │ │(Node)  │ │(Go) │ │(Node)    │ │          │
  └────┘ └────────┘ └──────┘ └──────────┘ └──────────┘

  Shared infra:
   - Postgres (lookups, users, payments) — owned by Gateway only
   - Redis (cache only; not the bus)
   - Each provider service owns its own small state DB if needed
```

## Tech stack

| Layer            | Choice                                              | Why                                                                  |
|------------------|-----------------------------------------------------|----------------------------------------------------------------------|
| Bus              | **NATS JetStream**                                  | Lighter than Kafka, durable, supports request/reply + streams        |
| Gateway          | NestJS + Fastify                                    | Same DI model you know                                               |
| Provider services| Polyglot (Node/Python/Go) using thin SDK            | Right tool per integration                                           |
| State            | Postgres (gateway) + per-service stores             | Bounded contexts                                                     |
| Cache            | Redis                                               | Per-service cache; no shared session state                           |
| Realtime         | WebSocket gateway → NATS subscribe                  | Multi-event, bidirectional (cancellation, throttling commands)       |
| Orchestration    | Docker Swarm or k3s                                 | Swarm if 1 node, k3s if you'll go multi-node                         |
| Service discovery| NATS subjects + DNS                                 | No Consul / etcd needed                                              |
| Schema contracts | Effect `Schema` published as `@echo/contracts`      | Versioned subject schemas; gateway and services share the package    |
| Observability    | OpenTelemetry → Grafana Cloud or self-hosted LGTM   | Trace propagation through NATS message headers                       |
| Auth / payments  | Same as Plan B                                      | Lives in gateway                                                     |

## Topic design (the load-bearing piece here)

```
lookup.requested.<providerId>     # Gateway → Provider (work)
lookup.event.<lookupId>           # Provider → Gateway (progress, partials)
lookup.result.<lookupId>          # Provider → Gateway (final)
lookup.cancel.<lookupId>          # Gateway → Provider (interrupt)

provider.health.<providerId>      # Provider → Gateway (heartbeat / capacity)
provider.register.<providerId>    # Provider → Gateway (on boot)
```

Each provider service:
- Subscribes to `lookup.requested.<own-id>` with a queue group (multiple replicas share work).
- Publishes events on `lookup.event.<lookupId>`.
- Listens for `lookup.cancel.<lookupId>` to abort in-flight work.
- Sends `provider.health.<own-id>` every 5s.

Adding a new provider = deploy a container that follows this contract. The gateway needs *zero* code changes for new providers — it discovers them via `provider.register.*`.

## Long-running request flow

1. `POST /api/lookups { providerId, query }` — gateway validates, persists lookup row (`status=queued`), publishes to `lookup.requested.<providerId>`.
2. Client opens WebSocket. Gateway subscribes that socket to `lookup.event.<lookupId>` and `lookup.result.<lookupId>`.
3. Provider replica pulls job, processes, streams events.
4. On `lookup.result.*`, gateway persists result, marks row `done`.
5. Cancellation: client sends WS message → gateway publishes `lookup.cancel.<lookupId>`. Provider Stream is interrupted.
6. Reconnects: WS handshake replays buffered events from JetStream KV / stream history (durable consumer with `deliver=last_per_subject`).

## Overload protection

- **Per-provider scaling**: NATS queue groups → add replicas to a hot provider; nothing else changes.
- **Provider self-throttling**: each service exposes its own concurrency via `provider.health` (e.g., "I'm at capacity, route elsewhere"). Gateway degrades or queues.
- **Gateway backpressure**: if a provider hasn't ack'd in N seconds, gateway returns `503` to new requests for that provider.
- **Edge rate limit**: Cloudflare WAF + per-user quota in gateway.
- **Circuit breakers**: per provider, in the gateway. Distinct from per-provider replica health.

## Caching

- Per-service caches (each service owns its own Redis namespace) — keeps providers self-contained.
- Optional gateway-level result cache for the most common queries (with single-flight via a NATS request/reply).

## Hosting

- Hetzner CCX or AX nodes:
  - 1× gateway box (or 2 behind a load balancer).
  - 1× NATS box (NATS is happy on small hardware).
  - 1× DB box (Postgres + Redis).
  - 1× generic "providers" box running Docker Swarm with all provider containers (start small, peel off later).
- Or, if you go k3s, 3 nodes minimum for control plane HA — significantly more ops.
- Estimated ~€80–€120/mo for a real production posture.

## Pros

- Adding the 50th OSINT integration costs the same as adding the 5th.
- Polyglot — pick the best language per integration (Sherlock stays Python natively).
- True per-provider scaling.
- Resilience: a broken provider can't bring down the gateway.
- Pleasant local dev: `nats-server` is a single binary.

## Cons

- 6–10 weeks to MVP solo.
- Many moving parts → many places to be wrong (subject naming, schema versioning, dead-letter handling).
- Distributed tracing is mandatory, not optional.
- Eventual consistency between gateway DB and provider state needs design.
- Overkill for the first ~20 providers if there's no scaling pressure.

## Where to start (first 2 weeks)

If you decide on Plan C up front, do *not* try to build all of it at once. Build the spine:

1. **Week 1**: NestJS gateway + NATS + ONE provider service (Sherlock, Python). Hard-code the Sherlock subject. Get a real lookup end-to-end through NATS.
2. **Week 2**: Extract the contracts package. Add the second provider service (GetContact stub, Node). Now the abstraction is real because you've used it twice.

If after week 2 it feels like overkill — switch to Plan B. The provider services map cleanly onto Plan B's `OsintProvider` interface.

## Honest gut-check

Solo dev + greenfield + your stated requirements (NestJS, Drizzle, Effect-TS, "not over-engineered") strongly suggests Plan B. Plan C is documented here so you can see the shape it would take, and so you can graduate into it without regret if you outgrow Plan B.

Pick Plan C only if you're confident about the four conditions at the top.
