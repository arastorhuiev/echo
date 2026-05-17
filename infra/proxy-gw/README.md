# Proxy gateway — architectural contract

Optional infrastructure that lets scrape-based OSINT providers (Sherlock, Maigret, future ones) route their outbound HTTP/HTTPS traffic through an upstream residential-proxy service when that becomes necessary to avoid bans.

This document is the **contract**: rules that, if respected, guarantee the proxy can be removed in a single revert without touching any application code.

## What this is

- `infra/proxy-gw/tinyproxy.conf` — config for [tinyproxy](https://tinyproxy.github.io/), a small forward HTTP/HTTPS proxy.
- A `proxy-gw` service in `docker-compose.yml` gated by the `proxy` compose profile (off by default).
- Three env variables on the `osint-py` service (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`) that the Python sidecar's HTTP libraries (`requests`, `httpx`) read automatically. **Empty by default.**

That is the full surface. There is no Python code, no TypeScript code, and no NestJS module that knows this service exists.

## Why tinyproxy (not haproxy / squid / nginx)

- Tinyproxy is a single-purpose forward HTTP/HTTPS proxy — exactly the shape we need.
- Config is one file, ~40 lines, including the commented templates for upstream providers.
- Pass-through mode requires zero config (no upstream block).
- Built-in support for upstream proxies, multi-provider round-robin, and per-host bypass — the three growth paths we care about.
- HAProxy is a load balancer; using it as a forward proxy requires non-standard `http-request set-dst` plumbing. Squid is correct but heavyweight. Nginx as a forward proxy is awkward.

## The contract — five rules that must not break

If all five hold, the proxy is removable in one revert.

1. **No application code reads, imports, or branches on the proxy.** The sidecar's Python code, the worker's TypeScript code, and any provider package must remain ignorant of this service. The only coupling is the `HTTPS_PROXY` env var, which is interpreted by third-party HTTP libraries, not by us.
2. **`HTTPS_PROXY` defaults to empty.** In `docker-compose.yml` the sidecar's env section uses `${HTTPS_PROXY:-}`. The `@echo/config` zod schema must keep this as `.optional()`. An empty value is the canonical "proxy off" state and the sidecar must behave identically with it as without it ever being set.
3. **No `depends_on` either direction.** The sidecar must not list `proxy-gw` as a dependency. No other service may either. If `proxy-gw` is missing or crashed, the rest of the stack starts and runs normally; only outbound proxy routing is unavailable.
4. **No `ENV HTTPS_PROXY=` in the sidecar's Dockerfile.** Proxy wiring lives only in the compose `environment:` section, never baked into a built image. (Baking would force an image rebuild to disable proxy, breaking rule 5.)
5. **No metric, dashboard, OpenAPI entry, or `/api/providers` field references the proxy.** Proxy is a deployment concern, not a product feature. Surfacing it in user-facing APIs would create real coupling.

## How to use it (operator view)

| You want to… | Do this |
|---|---|
| Run the stack without proxy (default) | `docker compose up -d` — `proxy-gw` does not start |
| Run the stack with `proxy-gw` running but pass-through (no upstream) | `docker compose --profile proxy up -d` — `proxy-gw` is up, but the sidecar still has empty `HTTPS_PROXY`, so traffic goes direct |
| Actually route sidecar traffic through `proxy-gw` (still pass-through to internet) | Set `HTTPS_PROXY=http://proxy-gw:8080` and `HTTP_PROXY=http://proxy-gw:8080` in `.env`, restart sidecar |
| Route through a paid upstream provider | Uncomment one upstream block in `tinyproxy.conf`, fill in credentials, restart `proxy-gw`. See `RUNBOOK.md` → "Proxy gateway" for the walkthrough |

## How to remove the proxy cleanly

When the project drops every scrape-based provider, the proxy infra goes too. Exact file/line list — no other surgery required.

1. `docker-compose.yml`:
   - Delete the entire `proxy-gw:` service block.
   - Delete the `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` lines from the `osint-py:` service `environment:` section.
   - Delete the section comments that introduced the optional infra subsection if it leaves only that one service.
2. `infra/proxy-gw/` — delete the directory.
3. `.env.example`:
   - Delete the `HTTPS_PROXY=`, `HTTP_PROXY=`, `NO_PROXY=` lines and their section header.
4. `docs/RUNBOOK.md`:
   - Delete the entire "Proxy gateway" section.
5. `docs/AGENT_PLAN.md`:
   - Mark P7a as `superseded` (don't delete — historical record).

That is the full removal. No Python, TypeScript, NestJS, Drizzle, or test-file changes anywhere. If any of those are required during removal, **rule 1 was broken at some earlier point** — that is the bug, not the removal.

## Cost preview

- **Pass-through (default):** $0 — no subscription, traffic exits via the docker host's IP.
- **Single residential provider, dev usage (~150–600 lookups/mo):** $5–10/mo on DataImpulse or IPRoyal stater plans.
- **Beta-scale usage (~15k lookups/mo):** $100–200/mo on Smartproxy or similar.

See the docstring in `RUNBOOK.md` → "Proxy gateway" for the specific provider links and current pricing.
