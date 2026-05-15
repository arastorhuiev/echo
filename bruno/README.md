# Bruno collection

API smoke tests for echo, runnable from [Bruno](https://www.usebruno.com/).

```bash
# Install once
brew install bruno

# Open the collection in the desktop app
bruno open bruno/echo-api

# Or run a single request from CLI
brew install bruno-cli
bru run bruno/echo-api/lookups/create-sherlock.bru --env local
```

The `local` environment points at `http://localhost:3000/api` for the API
and `http://localhost:8000` for the Python sidecar. Override either with
`bru run --env-var apiBase=https://staging.echo.example/api ...` when
hitting a non-local stack.

## Folder layout

- `lookups/` — `/api/lookups` lifecycle: create → stream → cancel.
- `sidecar/` — direct hits to `services/echo-osint-py` for sidecar
  health-debugging without the Node pipeline in the way.

Streaming SSE responses don't render usefully in the Bruno UI — each
streaming request's `docs` block has the curl equivalent that does.
