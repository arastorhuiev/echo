# Provider catalog

Single source of truth for every OSINT provider wired into echo. Each
card lists what the provider does, where it lives in the codebase, how
to invoke it (Bruno + curl), what its response looks like, and any
operational caveats.

> Removed in P8e: `emailrep` (paid API key now required), `gravatar` (per
> owner decision), `saucenao` (free tier still requires API key registration).
> Free, env-conditional providers (`truecaller`, `telegram-resolve`,
> `ghunt`, `mailcat`) stay — they only need disposable creds, not paid
> keys. See `docs/OWNER_TODO.md` for the one-time setup flows.

## Common conventions

- **Stream contract:** every provider returns SSE on `/api/lookups/<id>/stream`:
  `Started` → (optional `Partial` events) → `Final` on success, or
  `Failed` on terminal error. The Node consumer reads via `EventSource`;
  `Last-Event-ID` resumes mid-stream.
- **Sidecar contract:** providers backed by Python live in
  `services/echo-osint-py/app/*_runner.py` and are exposed at
  `POST /providers/<id>/run` (some sync JSON, some SSE — noted per card).
- **Env-conditional providers** return a clean `Final` with
  `configured: false` if their env vars aren't set; the rest of the
  pipeline keeps running.
- **Categories** drive metric labels + OpenAPI grouping:
  `username | email | phone | image | breach`.
  (Other categories — `domain | ip | social | crypto | tech | people | meta`
  — are reserved for future providers.)

## Test subject

All Bruno requests + the `efinswim` preset target this triple. Switch
in `bruno/echo-api/environments/local.bru`:

| field | default |
| --- | --- |
| username | `efinswim` |
| email | `efinswim@gmail.com` |
| phone | `+48537529192` (PL, dial 48, national 537529192) |
| image URL | ianare EXIF sample with GPS |
| profile URL | `https://t.me/durov` |

---

## Username category

### sherlock

- **Status:** implemented (P7)
- **What it does:** Username → list of social platforms where the
  handle exists, by HTTP-probing each platform's "user page" URL.
- **Integration:** Python sidecar — subprocess `python -u -m sherlock_project`,
  streaming per-site results.
- **Source:** [`sherlock-project/sherlock`](https://github.com/sherlock-project/sherlock)
  — Python, MIT, `sherlock-project==0.15.0`.
- **Input:** `{ "username": string }` — `^[A-Za-z0-9._-]{1,50}$`.
- **Output:** `{ "found": Array<{site, url}>, "checked": number }`.
- **Files:** `packages/providers/src/sherlock/` + `services/echo-osint-py/app/sherlock_runner.py`
- **Bruno:** `lookups/create-sherlock.bru` + `sidecar/sherlock-run.bru`
- **Caveats:** scrape-based; sites can rotate detection markers without
  notice. Long tail (~400 sites) means ~30-60s wall-clock.

### maigret

- **Status:** implemented (P8a)
- **What it does:** Sherlock's bigger sibling — broader site corpus
  (~3000 sites) with richer profile parsing.
- **Integration:** Python sidecar — subprocess `python -u -m maigret … --timeout 10`,
  streaming NDJSON per site.
- **Source:** [`soxoj/maigret`](https://github.com/soxoj/maigret)
  — Python, MIT, `maigret==0.6.1`.
- **Input:** `{ "username": string }`.
- **Output:** `{ "found": Array<{site, url}>, "checked": number }`.
  Same shape as Sherlock for orchestration dedup.
- **Files:** `packages/providers/src/maigret/` + `services/echo-osint-py/app/maigret_runner.py`
- **Bruno:** `lookups/create-maigret.bru` + `sidecar/maigret-run.bru`
- **Caveats:** runner now uses `--timeout 10` (per-site wait); the
  earlier `-T` shorthand is `--txt` in maigret 0.6.x and dropped `10`
  into positional args — fixed in P8e.

### whatsmyname

- **Status:** implemented (P8a)
- **What it does:** Username hunt against the vendored
  `WhatsMyName` dataset (~732 sites, CC-BY-SA-4.0) — Node-native, no
  sidecar.
- **Integration:** Node HTTP fan-out runner (~150 LOC) over
  `wmn-data.json`.
- **Source:** [`WebBreacher/WhatsMyName`](https://github.com/WebBreacher/WhatsMyName)
  — dataset pinned at commit `cf3346c5`.
- **Input:** `{ "username": string }`.
- **Output:** `{ "found": Array<{name, url, category}>, "checked": number, "total": number }`.
- **Files:** `packages/providers/src/whatsmyname/`
- **Bruno:** `lookups/create-whatsmyname.bru`
- **Caveats:** sites with `post_body` (POST + templated body) are
  filtered out at dataset-load time. Schema accepts empty `m_string` /
  `e_string` — those entries short-circuit at runtime (relaxed in
  P8e from strict `min(1)`).

### socialscan

- **Status:** implemented (P8a)
- **What it does:** Username/email availability across ~10 platforms
  (Instagram, Twitter, Reddit, GitHub, GitLab, Tumblr, …).
- **Integration:** Python sidecar — subprocess + JSON file dump.
- **Source:** [`iojw/socialscan`](https://github.com/iojw/socialscan)
  — MPL-2.0, `socialscan==2.0.1`.
- **Input:** `{ "queries": string[] }` — mix of usernames and emails,
  1-10 items.
- **Output:** SSE per-platform `result` events. Semantics flip:
  `available: false` ⇒ the handle is **taken** on that platform — that's
  the positive signal we surface as "exists-elsewhere".
- **Files:** `packages/providers/src/socialscan/` + `services/echo-osint-py/app/socialscan_runner.py`
- **Bruno:** `lookups/create-socialscan.bru` + `sidecar/socialscan-run.bru`
- **Caveats:** socialscan 2.x writes a `{ <query>: [entries] }` dict
  with `"True"`/`"False"` strings (not real bools); runner normalises
  both shapes (fixed in P8e).

### socid-extractor

- **Status:** implemented (P8b)
- **What it does:** URL → site-specific identifiers (Telegram user_id,
  VK profile id, GitHub commit emails, etc.). ~130 site parsers. Designed
  as a post-processor for Sherlock/Maigret/WhatsMyName hits.
- **Integration:** Python sidecar — in-process; sidecar fetches via
  httpx, then calls `socid_extractor.extract()`.
- **Source:** [`soxoj/socid-extractor`](https://github.com/soxoj/socid-extractor)
  — MIT, `socid-extractor==0.0.28`.
- **Input:** `{ "url": string }`.
- **Output:** `{ "found": boolean, "url": string, "fields": object, "error": string | null }`.
  Field values heterogeneous (string / number / bool / array-of-strings).
- **Files:** `packages/providers/src/socid-extractor/` + `services/echo-osint-py/app/socid_extractor_runner.py`
- **Bruno:** `lookups/create-socid-extractor.bru` + `sidecar/socid-extractor-run.bru`
- **Caveats:** parsers drift when sites change HTML. Stringified
  Python lists (`"['a','b']"`) get normalised back to arrays via
  `ast.literal_eval`.

### mailcat † env-conditional

- **Status:** implemented scaffold (P8c). Activates only with
  `MAILCAT_INSTALL_PATH` set.
- **What it does:** Username → guessed email addresses across ~22
  common providers (Gmail, ProtonMail, Outlook, etc.).
- **Integration:** Python sidecar — subprocess on a manually-provisioned
  clone (heavy Chromium dep keeps it out of the default image).
- **Source:** [`sharsil/mailcat`](https://github.com/sharsil/mailcat)
  — Apache-2.0.
- **Input:** `{ "username": string }`.
- **Output:** SSE per-provider results; Final's `found` is the
  convenience list of `exists: true` entries.
- **Files:** `packages/providers/src/mailcat/` + `services/echo-osint-py/app/mailcat_runner.py`
- **Bruno:** `lookups/create-mailcat.bru` + `sidecar/mailcat-run.bru`
- **Setup:** see `docs/OWNER_TODO.md` — clone repo, `pip install -r requirements.txt`,
  mount path into the container.

---

## Phone category

### phonenumbers

- **Status:** implemented (P8a)
- **What it does:** Pure-offline libphonenumber lookup —
  valid/possible flags, region/country code, carrier, line type,
  geocoded location, timezones.
- **Integration:** Python sidecar — in-process (no subprocess).
- **Source:** [`daviddrysdale/python-phonenumbers`](https://github.com/daviddrysdale/python-phonenumbers)
  — Apache-2.0, `phonenumbers==9.0.7`.
- **Input:** `{ "phone": string }` (any human format; libphonenumber
  parses).
- **Output:** Sync JSON via sidecar — `{ valid, possible, e164,
  national_format, international_format, country_code, region_code,
  number_type, carrier_name, geocoded_location, timezones, parse_error }`.
- **Files:** `packages/providers/src/phonenumbers/` + `services/echo-osint-py/app/phonenumbers_runner.py`
- **Bruno:** `lookups/create-phonenumbers.bru` + `sidecar/phonenumbers-run.bru`
- **Caveats:** carrier coverage uneven. Mobile numbers in EU/CIS
  usually populated; UK fixed-line often blank.

### phoneinfoga

- **Status:** implemented (P8a, rewired to REST in P8e)
- **What it does:** Country/carrier metadata plus a list of
  ready-to-click Google dork URLs ("search this number on Facebook /
  LinkedIn / pastebins / SMS-listening sites").
- **Integration:** Python sidecar runs `phoneinfoga serve --no-client`
  in the background (via FastAPI lifespan), POSTs to
  `/api/v2/scanners/{local,googlesearch}/run`.
- **Source:** [`sundowndev/phoneinfoga`](https://github.com/sundowndev/phoneinfoga)
  — Go, GPL-3.0, binary v2.11.0 (amd64 — arm64 needs per-arch fetch
  in the sidecar Dockerfile).
- **Input:** `{ "phone": string }` (any format; runner strips to digits
  before the REST call).
- **Output:** Sync JSON — `{ local_scanner: {valid, country,
  country_code, carrier, line_type}, google_dorks: string[], error:
  string | null }`.
- **Files:** `packages/providers/src/phoneinfoga/` + `services/echo-osint-py/app/phoneinfoga_runner.py`
- **Bruno:** `lookups/create-phoneinfoga.bru` + `sidecar/phoneinfoga-run.bru`
- **Caveats:** PhoneInfoga v2.11 removed the `-o <json>` flag from
  `scan` — the runner switched to the embedded REST API in P8e.
  `carrier` / `line_type` are blank from the `local` scanner; richer
  fields require `numverify` / `ovh` scanners which need API keys we
  don't have.

### telegram-resolve † env-conditional

- **Status:** implemented scaffold (P8a). Activates only with
  `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` + `TELEGRAM_SESSION_PATH`.
- **What it does:** Phone → Telegram profile via MTProto
  (`ImportContacts → GetFullUser → DeleteContacts`).
- **Integration:** Python sidecar — in-process Telethon client.
- **Source:** [`Lonami/Telethon` on Codeberg](https://codeberg.org/Lonami/Telethon)
  — MIT, `telethon==1.39.0`. GitHub mirror archived 2026-02 (project
  moved to Codeberg; PyPI publication unchanged).
- **Input:** `{ "phone": string }`.
- **Output:** Sync JSON — `{ configured, found_on_telegram, user_id,
  username, first_name, last_name, about, status, is_premium, is_bot,
  is_verified, is_scam, is_fake, photo_url, error }`.
- **Files:** `packages/providers/src/telegram-resolve/` + `services/echo-osint-py/app/telegram_runner.py`
- **Bruno:** `lookups/create-telegram-resolve.bru` + `sidecar/telegram-resolve-run.bru`
- **Caveats:** users with `Who can find me by phone = My Contacts`
  return `found_on_telegram: false` even when they exist on Telegram —
  by design. ResolvePhone adds the contact on our side; runner always
  deletes it on exit.
- **Setup:** see `docs/OWNER_TODO.md`.

### truecaller † env-conditional

- **Status:** implemented scaffold (P8a, async API in P8e). Activates
  only with `TRUECALLER_INSTALLATION_ID`.
- **What it does:** Phone → name, image, spam score, linked emails
  from Truecaller's crowd-sourced corpus.
- **Integration:** Python sidecar — `truecallerpy.search_phonenumber`
  (now async, camelCase kwargs).
- **Source:** [`sumithemmadi/truecallerpy`](https://github.com/sumithemmadi/truecallerpy)
  — MIT, `truecallerpy==1.0.3`. 0.1.x was unpublished from PyPI in
  2026, forcing the major bump.
- **Input:** `{ "phone": string, "country_code": string }` (ISO-2;
  used by libphonenumber inside the wrapper).
- **Output:** Sync JSON — `{ configured, found, name, alt_name,
  image_url, gender, addresses[], emails[], tags[], spam_info: {spam_score, spam_type},
  score, access, enhanced, error }`.
- **Files:** `packages/providers/src/truecaller/` + `services/echo-osint-py/app/truecaller_runner.py`
- **Bruno:** `lookups/create-truecaller.bru` + `sidecar/truecaller-run.bru`
- **Caveats:** unofficial wrapper. ToS-violating (UI must label this
  as "crowd-sourced from Truecaller"). HTTP-401 errors indicate the
  installationId was banned; re-run SMS login on a fresh SIM.
- **Setup:** see `docs/OWNER_TODO.md`.

### ignorant

- **Status:** implemented (P8c, fixed in P8e)
- **What it does:** Phone → social presence on Instagram / Snapchat /
  Amazon. `exists: true` ⇒ the number is registered on that platform.
- **Integration:** Python sidecar — subprocess on the `ignorant`
  console script (GPL-3.0 so we keep it at arm's length); parse
  `[+]` / `[-]` / `[x]` lines from stdout.
- **Source:** [`megadose/ignorant`](https://github.com/megadose/ignorant)
  — GPL-3.0, `ignorant==1.2`.
- **Input:** `{ "country_code": string, "phone": string }` — both
  digits-only (no `+`); matches the upstream positional CLI convention.
- **Output:** SSE per-platform `result` events with `exists` and
  `rate_limit` booleans.
- **Files:** `packages/providers/src/ignorant/` + `services/echo-osint-py/app/ignorant_runner.py`
- **Bruno:** `lookups/create-ignorant.bru` + `sidecar/ignorant-run.bru`
- **Caveats:** ignorant 1.2 has no `__main__.py`; runner now invokes
  the `ignorant` binary directly (fixed in P8e). Output is human-text,
  not JSON — runner parses the `[+|-|x] domain.tld` lines.

---

## Email category

### hibp-pwned-passwords

- **Status:** implemented (P8a)
- **What it does:** Validates a password against the breach corpus
  without ever sending the password — client-side SHA-1, only the first
  5 hex chars of the hash leave the process.
- **Integration:** Node-native HTTP fetch (no sidecar, no auth).
- **Source:** `https://api.pwnedpasswords.com/range/<prefix>`
- **Input:** `{ "password": string }`.
- **Output:** `{ "found": boolean, "breach_count": number }`.
- **Files:** `packages/providers/src/hibp/`
- **Bruno:** `lookups/create-hibp.bru`
- **Caveats:** the password itself never crosses a network boundary,
  but the request body is visible in Bruno's UI — use placeholders.

### ghunt † env-conditional

- **Status:** implemented (P8c). Activates only with `GHUNT_CREDS_PATH`
  set to an existing `creds.m` file.
- **What it does:** Email → Google profile (real name, gaia_id,
  profile picture, Maps reviews count, calendar visibility). Often the
  highest-value email→identity bridge.
- **Integration:** Python sidecar — subprocess `ghunt email <addr>
  --json <tmpfile>` (AGPL-3.0 kept at binary boundary). AGPL §13 network
  clause doesn't trigger because we don't modify GHunt.
- **Source:** [`mxrch/GHunt`](https://github.com/mxrch/GHunt)
  — AGPL-3.0, `ghunt==2.3.3`.
- **Input:** `{ "email": string }`.
- **Output:** Sync JSON — `{ configured, found, name, gaia_id,
  profile_picture, cover_photo, emails[], reviews_count,
  maps_contributions, calendar_visible, error }`.
- **Files:** `packages/providers/src/ghunt/` + `services/echo-osint-py/app/ghunt_runner.py`
- **Bruno:** `lookups/create-ghunt.bru` + `sidecar/ghunt-run.bru`
- **Caveats:** stale Google cookies → 401 in stderr; re-run `ghunt
  login`. Runner pins httpx to 0.27.2 because ghunt 2.3.3 requires
  `httpx<0.28`.
- **Setup:** see `docs/OWNER_TODO.md`.

---

## Image category

### exiftool

- **Status:** implemented (P8d)
- **What it does:** Image URL → EXIF / IPTC / XMP metadata: camera
  make/model/lens, GPS lat/lon/alt, IPTC byline/credit, XMP
  creator/rights.
- **Integration:** Python sidecar — downloads the image URL into a tmp
  file (32 MiB cap), runs `exiftool -json -G -fast2`, slims to a fixed
  field allowlist.
- **Source:** [`exiftool/exiftool`](https://exiftool.org/) — GPL-3.0 +
  Artistic dual-licensed; installed via
  `libimage-exiftool-perl` in the sidecar Dockerfile.
- **Input:** `{ "image_url": string }`.
- **Output:** `{ found, file_type, mime_type, width, height, make,
  model, lens_model, software, date_taken, gps_latitude, gps_longitude,
  gps_altitude, gps_date, byline, credit, source, copyright, creator,
  rights, error }`.
- **Files:** `packages/providers/src/exiftool/` + `services/echo-osint-py/app/exiftool_runner.py`
- **Bruno:** `lookups/create-exiftool.bru` + `sidecar/exiftool-run.bru`
- **Caveats:** GPS arrives as exiftool's native string format (`37 deg
  24' 35.40" N`); UI parses if it wants numeric. Download failures and
  oversize images land in `error` rather than 5xx.

---

## Known categorical gaps (paid-only in 2026)

These have no good **free** option in 2026 and are intentionally left
out of the catalog. Don't promise them in the UI without a paid path:

- **Breach data beyond hash check** — HIBP commercial API, DeHashed,
  LeakCheck, Snusbase all paid.
- **Reverse image / face search** — Google / Bing / Yandex / TinEye /
  PimEyes / FaceCheck.id all blocked or paid for programmatic use.
- **People search / public records** — Pipl, Spokeo, BeenVerified,
  Whitepages all paid.
- **Premium Twitter/X** — paid via X API or Sprinklr/Brandwatch.
- **Email reputation scoring** — EmailRep killed unauth tier in 2026
  (was free; now paid key).

---

## How to add a new provider

1. Pick the integration pattern (Node-native, Python sidecar, REST
   subprocess).
2. Implement the `OsintProvider` interface in
   `packages/providers/src/<id>/<id>.ts` — define `inputSchema`,
   `outputSchema`, `defaults`, `run()`.
3. If the provider is sidecar-backed, add the matching
   `services/echo-osint-py/app/<id>_runner.py` plus a FastAPI route in
   `app/main.py`.
4. Register the provider in both `apps/api/src/app.module.ts` and
   `apps/worker/src/app.module.ts`.
5. Export from `packages/providers/src/index.ts`.
6. Add Bruno requests:
   - `bruno/echo-api/lookups/create-<id>.bru` (always)
   - `bruno/echo-api/sidecar/<id>-run.bru` (if sidecar-backed)
   - Use the `testUsername` / `testEmail` / `testPhone` env vars, not
     hardcoded values.
7. Add a card here.
8. `pnpm test --filter @echo/providers` should pass the conformance
   test for the new provider.
