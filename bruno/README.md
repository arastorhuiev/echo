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

## Test subject

Every `create-*` / `sidecar-*` request reads the test target from the
environment so a single edit retargets the whole collection. The vars
live in `environments/local.bru`:

| var | default | used by |
|---|---|---|
| `testUsername` | `efinswim` | sherlock, maigret, whatsmyname, socialscan, mailcat |
| `testEmail` | `efinswim@gmail.com` | ghunt, socialscan |
| `testPhone` | `+48537529192` | phonenumbers, phoneinfoga, telegram-resolve, truecaller |
| `testPhoneCountryDial` | `48` | ignorant (`country_code` positional, no `+`) |
| `testPhoneNational` | `537529192` | ignorant (`phone` positional, digits only) |
| `testPhoneCountryIso` | `PL` | truecaller (`country_code` ISO-2) |
| `testProfileUrl` | `https://t.me/durov` | socid-extractor |
| `testImageUrl` | (ianare EXIF sample) | exiftool |

Swap the value in `environments/local.bru` to retarget; the requests
themselves stay intact.

## Folder layout

- `lookups/` — `/api/lookups` lifecycle: one `create-<provider>.bru` per
  active provider, plus a single `stream-sherlock.bru` / `cancel-sherlock.bru`
  pair that work generically via the `{{lookupId}}` var saved by any
  create request.
- `sidecar/` — direct hits to `services/echo-osint-py` for sidecar
  health-debugging without the Node pipeline in the way. One per
  sidecar-backed provider plus `health.bru` and `info.bru`.

Streaming SSE responses don't render usefully in the Bruno UI — each
streaming request's `docs` block has the curl equivalent that does.

## Provider coverage

Every active provider has at least one `create-<id>.bru` under `lookups/`.
Sidecar-backed providers additionally have a `<id>-run.bru` under
`sidecar/` for direct-hit isolation.

### Phone

| Provider | API request | Sidecar direct |
|---|---|---|
| `phonenumbers` | `lookups/create-phonenumbers.bru` | `sidecar/phonenumbers-run.bru` |
| `phoneinfoga` | `lookups/create-phoneinfoga.bru` | `sidecar/phoneinfoga-run.bru` |
| `telegram-resolve` † | `lookups/create-telegram-resolve.bru` | `sidecar/telegram-resolve-run.bru` |
| `truecaller` † | `lookups/create-truecaller.bru` | `sidecar/truecaller-run.bru` |
| `ignorant` | `lookups/create-ignorant.bru` | `sidecar/ignorant-run.bru` |

### Email

| Provider | API request | Sidecar direct |
|---|---|---|
| `hibp-pwned-passwords` | `lookups/create-hibp.bru` | — (HTTP-fetch, no sidecar) |
| `ghunt` † | `lookups/create-ghunt.bru` | `sidecar/ghunt-run.bru` |

### Username

| Provider | API request | Sidecar direct |
|---|---|---|
| `sherlock` | `lookups/create-sherlock.bru` | `sidecar/sherlock-run.bru` |
| `maigret` | `lookups/create-maigret.bru` | `sidecar/maigret-run.bru` |
| `whatsmyname` | `lookups/create-whatsmyname.bru` | — (Node-native runner, no sidecar) |
| `socialscan` | `lookups/create-socialscan.bru` | `sidecar/socialscan-run.bru` |
| `socid-extractor` | `lookups/create-socid-extractor.bru` | `sidecar/socid-extractor-run.bru` |
| `mailcat` † | `lookups/create-mailcat.bru` | `sidecar/mailcat-run.bru` |

### Image

| Provider | API request | Sidecar direct |
|---|---|---|
| `exiftool` | `lookups/create-exiftool.bru` | `sidecar/exiftool-run.bru` |

**†** = env-conditional. Without the relevant env vars set, the Final
carries `configured: false` plus an instructive error pointing at
`docs/OWNER_TODO.md` / `docs/RUNBOOK.md`.

## Generic helpers

- `lookups/list-providers.bru` — `GET /api/providers`. Confirms the
  registry has every expected ID at boot.
- `lookups/stream-sherlock.bru` — `GET /api/lookups/{{lookupId}}/stream`.
  Reuses whichever `lookupId` the most recent create request saved;
  works for any provider despite the name.
- `lookups/cancel-sherlock.bru` — `DELETE /api/lookups/{{lookupId}}`.
  Same — generic across providers, named for legacy reasons.
- `sidecar/health.bru` — sidecar liveness probe.
- `sidecar/info.bru` — sidecar provider catalog (matches what's registered
  on the Node side).

## How to add a new provider

1. Add `lookups/create-<id>.bru` modelled on the closest existing request.
   Use the `testUsername` / `testEmail` / `testPhone` vars rather than
   hardcoding values.
2. If the provider lives in the Python sidecar, add `sidecar/<id>-run.bru`
   too.
3. Update this README's coverage table and `docs/PROVIDERS.md`'s
   provider card.
4. Use `bru run --env local <new>.bru` to smoke-test once.
