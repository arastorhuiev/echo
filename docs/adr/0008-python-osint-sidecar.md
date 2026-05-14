# 0008. Python OSINT sidecar

**Status:** Accepted
**Date:** 2026-05-14

## Context

Many essential OSINT tools are Python-only or have their best implementations in Python: Sherlock, Maigret, Holehe, theHarvester, PhoneInfoga (Go), instaloader, and more. Reimplementing them in Node would be a maintenance trap; spawning Python as a subprocess per request pays ~80–150 ms of fork/import overhead per call and leaks zombies under load.

## Decision

Run a single FastAPI service at `services/echo-osint-py/` that hosts every Python-only OSINT tool. The Node worker calls it over HTTP (with SSE for streaming providers).

- **Tech:** Python 3.13, FastAPI, uvicorn, httpx, plus the OSINT libraries themselves.
- **Endpoints:** `POST /providers/<id>/run` (returns SSE for streaming providers; JSON for one-shot), `GET /providers/<id>/info`, `GET /info` (lists supported tools), `GET /health`.
- **Cancellation:** Python side respects request disconnect (`request.is_disconnected()` in FastAPI) and aborts in-flight tool calls via a per-request `asyncio.Event`.
- **Proxy support:** a shared, round-robin proxy pool (env-configurable) for tools that scrape — Sherlock, Maigret, instaloader.
- **Container:** one Docker image; multi-stage build to keep size manageable.

## Consequences

**Good:**
- One image, one set of Dockerfile dependencies, one process per host.
- Amortizes Python interpreter and library import time across all requests.
- Consistent error and event shape that the Node provider implementations can rely on.
- One place to add proxy rotation, retry shims, ToS-friendly delays.
- Easy to scale: more replicas of `echo-osint-py` if Python work becomes the bottleneck.

**Bad:**
- A second runtime in production (Python). Solo dev must keep both languages current.
- Network call between Node worker and Python sidecar adds ~1–5 ms per request — negligible vs OSINT latency.
- Single-process Python sidecar is a blast-radius concern: a crashy tool can take down the others. Mitigation: gunicorn worker model (multiple uvicorn workers behind gunicorn) or per-tool subprocess inside the sidecar for the most failure-prone tools.

## Alternatives considered

- **Spawn Python subprocess per call (Plan A approach).** Slow startup, hard to manage proxies and bans, fork-bomb risk under load.
- **Reimplement Python tools in Node.** Maintenance trap. Sherlock's sites database alone changes weekly; we'd be perpetually behind upstream.
- **One container per Python tool.** Docker image sprawl, more processes to monitor, no savings over the shared sidecar at our scale.
- **Use an existing aggregator (SpiderFoot, Recon-ng) as the sidecar.** Considered; they're heavyweight and opinionated, and we lose the per-provider abstraction control we want.

## Triggers to reconsider

- One Python tool needs vastly different proxy / scaling / failure-isolation properties → spin it out into its own sidecar (the abstraction in [0005](./0005-osint-provider-abstraction.md) makes this transparent to callers).
- Sidecar process becomes CPU- or memory-bound → split into category-shaped sidecars (e.g., `echo-username-py`, `echo-email-py`).
- We adopt a different scraping language (Go, Rust) for some tools → add another sidecar; the same provider abstraction applies.
