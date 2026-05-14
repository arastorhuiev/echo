# 0007. Real-time progress — Server-Sent Events

**Status:** Accepted
**Date:** 2026-05-14

## Context

OSINT lookups stream interesting events as they progress: Sherlock prints each site as it's checked, theHarvester finds emails one at a time, Holehe reports per-platform results. The frontend needs to surface these live so users see "we're checking site X / found Y so far" instead of a blank spinner. We need server-push, reconnect tolerance, and replay of missed events.

## Decision

- **Transport:** Server-Sent Events (SSE) over HTTP/1.1 (`text/event-stream`).
- **Endpoint:** `GET /api/lookups/:id/stream`.
- **Resume:** clients send `Last-Event-ID`; server resumes from the next entry in the Redis Stream `lookup:events:<id>`.
- **Retention:** Redis Stream entries are retained for 1 hour after the lookup's final event (configurable). Permanent durable history lives in Postgres `lookup_events`.
- **Cancellation:** done via `DELETE /api/lookups/:id` (REST), not SSE — keeps SSE one-way.

## Consequences

**Good:**
- Plumbing is simpler than WebSocket — a single GET, no upgrade dance.
- Built-in reconnect via `Last-Event-ID` is a real protocol feature, not a bolt-on.
- Works through Cloudflare proxy without special config.
- Browser `EventSource` API is one line; native to most SDKs.

**Bad:**
- HTTP/1.1 long-lived connections eat one connection slot per active lookup. Mitigation: Caddy + Cloudflare both handle long-lived HTTP fine; we monitor connection counts.
- One-way only — cancellation and any future "throttle me" command needs a separate REST call.
- Some corporate proxies buffer responses, defeating the live-stream effect; we can't fix every customer's network.

## Alternatives considered

- **WebSocket** — bidirectional, but we don't need it now; would add complexity (handshake, ping/pong, reconnect logic).
- **GraphQL subscriptions** — ties the API to Apollo; overkill for one channel.
- **Long polling** — wasteful, awkward.
- **gRPC streaming** — not browser-native; needs a JS gateway anyway.

## Triggers to reconsider

- Need bidirectional comms (e.g., live throttling commands, interactive tool selection) → migrate to WebSocket.
- Long-lived connection counts approach Caddy / Cloudflare limits → consider chunked HTTP polling or WebSocket multiplexing.
- Streaming requirements grow to multi-channel-per-connection → reconsider transport.
