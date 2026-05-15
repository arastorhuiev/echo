# echo-osint-py

Python OSINT sidecar for the echo backend. Hosts Python-only OSINT tools
behind a single FastAPI service — the Node worker calls in over HTTP.

See [`docs/adr/0008-python-osint-sidecar.md`](../../docs/adr/0008-python-osint-sidecar.md)
for the design rationale.

## Endpoints

- `GET /health` — liveness probe. Returns `{"status":"ok"}`.
- `GET /info` — catalog of providers this sidecar can run.
- `POST /providers/sherlock/run` — body `{"username":"<name>"}`, returns
  `text/event-stream` of per-site events. Closes the stream when the run
  finishes; the child sherlock process is killed if the client disconnects.

## Event shape

Each SSE frame is `data: {<JSON>}\n\n`. The JSON has a `kind` discriminator:

| `kind`      | Other fields                          |
| ----------- | ------------------------------------- |
| `started`   | `username`                            |
| `found`     | `site`, `url`                         |
| `not_found` | `site`                                |
| `done`      | `checked` (total sites parsed)        |
| `error`     | `message`                             |

The Node-side `@echo/providers/sherlock` provider translates these into
the canonical `ProviderEvent` shape: `Started` → `Partial` per `found` →
`Final { found:[{site,url}], checked }`.

## Local dev

```bash
docker compose up -d --build osint-py
curl http://localhost:8000/health
curl -N -X POST http://localhost:8000/providers/sherlock/run \
  -H 'Content-Type: application/json' \
  -d '{"username":"anthropic"}'
```

`-N` disables curl's output buffering so each SSE frame prints on arrival.

## Provider versioning

`sherlock-project` is pinned in `pyproject.toml`. The upstream site list
changes weekly — bump the pin deliberately, not on every rebuild, so we
can correlate result-quality changes with version bumps.
