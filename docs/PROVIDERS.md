# OSINT Provider Catalog

> Catalog of OSINT providers integrated (or planned) for **echo**. This document is the source of truth for what's wired up and what's coming.
>
> **Verification status:** the 8 Phase 1 starter providers were verified against `api.github.com` on **2026-05-14**. Star counts and last-push dates below are point-in-time; re-verify before each new phase. Categories beyond the starter set still carry `planned-unverified` until someone confirms them.

## Status legend

- `planned-unverified` — candidate from research; needs live verification before implementation
- `planned` — verified candidate, queued for implementation
- `planned-stale` — verified, but upstream hasn't shipped recently — pin a known revision and add to "watch for fork" list
- `implemented` — code lives in `packages/providers/<id>/` (or `services/echo-osint-py/app/`); conformance test green
- `disabled` — implemented but currently switched off (see `providers.enabled` row)
- `deferred` — known candidate for later phase
- `dead` — confirmed abandoned; do not adopt

---

## Phase 1 starter set (8 providers — verified 2026-05-14)

Covers 6 of 12 categories and exercises all four integration patterns (Python sidecar, Go subprocess, Node-native, hosted API).

### 1. Sherlock (`username`)
- **Status:** implemented (P7, 2026-05-15)
- **Integration pattern:** Python sidecar
- **Source:** [`sherlock-project/sherlock`](https://github.com/sherlock-project/sherlock) — Python — MIT — pinned `sherlock-project==0.15.0`
- **Verified 2026-05-14:** ⭐ 83 320 · last push **2026-05-14** · not archived
- **What it does:** Hunts a username across hundreds of social platforms.
- **Risks:** scrape-based, ban-prone, benefits from proxy rotation; site list rots — `services/echo-osint-py/pyproject.toml` pins the version, bump deliberately.
- **Defaults:** `timeoutMs: 60_000, maxConcurrent: 4, cacheTtlSec: 86_400, breaker: { 5, 30_000 }`
- **Implementation:** `packages/providers/src/sherlock/` (Node-side); `services/echo-osint-py/app/sherlock_runner.py` (sidecar). The sidecar spawns `python -u -m sherlock_project` per request, streams per-site results as `text/event-stream`, terminates the child on client disconnect.
- **Input:** `{ username: string }` — restricted to `^[A-Za-z0-9._-]{1,50}$` at both edges (Zod in api, regex in sidecar).
- **Output:** `{ found: Array<{ site, url }>, checked: number }`.
- **Bruno:** `bruno/echo-api/lookups/create-sherlock.bru` + companion stream/cancel requests.

#### Sample I/O

Request (POST `/api/lookups`):

```json
{ "providerId": "sherlock", "query": { "username": "anthropic" } }
```

Response:

```json
{ "id": "8f3e…-…", "streamUrl": "/api/lookups/8f3e…-…/stream" }
```

Stream (one `data:` frame per SSE event):

```
data: {"_tag":"Started"}
data: {"_tag":"Partial","chunk":{"site":"GitHub","url":"https://github.com/anthropic"}}
data: {"_tag":"Partial","chunk":{"site":"HackerNews","url":"https://news.ycombinator.com/user?id=anthropic"}}
data: {"_tag":"Final","data":{"found":[…],"checked":407}}
```

### 2. Maigret (`username`)
- **Status:** implemented (P8a, 2026-05-19)
- **Integration pattern:** Python sidecar
- **Source:** [`soxoj/maigret`](https://github.com/soxoj/maigret) — Python — MIT
- **Verified 2026-05-14:** ⭐ 28 563 · last push **2026-05-14** (today) · not archived
- **What it does:** Sherlock-derived; richer profile parsing and report generation.
- **Risks:** same as Sherlock; complementary results, not redundant.
- **Defaults (sketch):** `timeoutMs: 90000, maxConcurrent: 2, cacheTtlSec: 86400`

### 3. Holehe (`email`)
- **Status:** deferred (REV-3 2026-05-19) — superseded by Gravatar + GHunt + mailcat combination per `p8-final-plan-2026-05-19-ru.md` § 7.1
- **Integration pattern:** Python sidecar
- **Source:** [`megadose/holehe`](https://github.com/megadose/holehe) — Python — GPL-3.0
- **Verified 2026-05-14:** ⭐ 10 931 · last push **2024-09-10** (~20 months stale) · not archived
- **What it does:** Probes ~120 sites to see if an email has an account there.
- **Risks:** **upstream stale** — site checks may be silently broken since many providers changed their flows in 2024–2025. Concrete plan: pin to the last release, run the conformance test against ~20 known emails, accept some site failures, and watch for a maintained fork. If site coverage drops below 50%, demote to `disabled` and look for replacements (h8mail is the closest equivalent but also has license/scope concerns).
- **Defaults (sketch):** `timeoutMs: 60000, maxConcurrent: 2, cacheTtlSec: 86400`

### 4. PhoneInfoga (`phone`)
- **Status:** implemented (P8a, 2026-05-19)
- **Integration pattern:** CLI subprocess (Go binary baked into the worker or sidecar image)
- **Source:** [`sundowndev/phoneinfoga`](https://github.com/sundowndev/phoneinfoga) — Go — GPL-3.0
- **Verified 2026-05-14:** ⭐ 16 421 · last push **2026-01-06** · not archived
- **What it does:** Carrier + country + Google dorking for phone numbers.
- **Risks:** Google dorking is ToS gray; surface results as informational. GPL-3.0 — `echo` calls the binary out-of-process, so we're a user, not a derivative; verify our distribution model still respects this.
- **Defaults (sketch):** `timeoutMs: 30000, maxConcurrent: 4, cacheTtlSec: 604800`

### 5. Subfinder (`domain`)
- **Status:** planned
- **Integration pattern:** CLI subprocess (Go binary)
- **Source:** [`projectdiscovery/subfinder`](https://github.com/projectdiscovery/subfinder) — Go — MIT (default branch: `dev`)
- **Verified 2026-05-14:** ⭐ 13 622 · last push **2026-05-13** (yesterday) · not archived
- **What it does:** Passive subdomain enumeration across many third-party data sources.
- **Risks:** several data sources work better with API keys (Censys, SecurityTrails, Shodan); start with key-less sources, document which keys would expand coverage.
- **Defaults (sketch):** `timeoutMs: 60000, maxConcurrent: 4, cacheTtlSec: 86400`

### 6. whoiser (`domain`)
- **Status:** planned
- **Integration pattern:** Node-native (npm)
- **Source:** [`LayeredStudio/whoiser`](https://github.com/LayeredStudio/whoiser) — JavaScript/TypeScript — MIT
- **Verified 2026-05-14:** ⭐ 266 · last push **2025-11-30** · not archived
- **What it does:** Pure-Node WHOIS lookup with parser; no external CLI dependency.
- **Risks:** smaller community than the giants, but maintained and the WHOIS protocol is stable. WHOIS server availability varies; some TLDs return rate-limited or junk data — handle that in the provider's outputSchema as a partial-result case.
- **Defaults (sketch):** `timeoutMs: 15000, maxConcurrent: 8, cacheTtlSec: 86400`

### 7. IPinfo (`ip`)
- **Status:** planned (hosted)
- **Integration pattern:** Hosted API (free tier with key, ~50k req/mo)
- **Source:** [ipinfo.io](https://ipinfo.io)
- **What it does:** IP geolocation, ASN, organization, hosting flag.
- **Risks:** key required (env var, never committed); free tier metered → the cost guard ([ADR-0010](./adr/0010-rate-limiting-without-auth.md)) protects the quota. ToS forbids redistribution of bulk data.
- **Defaults (sketch):** `timeoutMs: 10000, maxConcurrent: 16, cacheTtlSec: 604800`

### 8. exifr (`image`)
- **Status:** deferred (REV-3 2026-05-19) — superseded by ExifTool (queued for P8d image foundation)
- **Integration pattern:** Node-native (npm)
- **Source:** [`MikeKovarik/exifr`](https://github.com/MikeKovarik/exifr) — JavaScript — MIT
- **Verified 2026-05-14:** ⭐ 1 224 · last push **2024-03-29** (~26 months stale) · not archived
- **What it does:** Reads EXIF / IPTC / XMP metadata from uploaded images.
- **Risks:** **upstream stale**, but EXIF is a stable spec and the library covers the common cases. Acceptable for now. Image uploads add a new attack surface (size limits, file-type validation, transient storage) — covered as part of the P8 implementation work item.
- **Alternative if exifr breaks:** `exiftool-vendored` (Node wrapper around Phil Harvey's ExifTool — heavyweight but bulletproof).
- **Defaults (sketch):** `timeoutMs: 5000, maxConcurrent: 8, cacheTtlSec: 0` (per-upload, not cached)

---

## Phase 8a additions (10 providers implemented 2026-05-19)

> Canonical plan: [`docs/research/p8-final-plan-2026-05-19-ru.md`](./research/p8-final-plan-2026-05-19-ru.md) (REV-3).
> All providers below conformance-test green, registered in api + worker registries, mockable via `FetchLike` for unit tests.

### 9. Gravatar (`email`)
- **Status:** implemented (P8a)
- **Integration pattern:** HTTP fetch (no sidecar)
- **Source:** Gravatar REST v3 public API — `https://api.gravatar.com/v3/profiles/<sha256>`
- **License/Auth:** public unauthenticated. SHA-256 of trimmed lowercase email is the identifier.
- **What it does:** Email → public profile (display name, location, job title, verified accounts).
- **Risks:** rate-limited per IP; 404 is a normal "no Gravatar" result, not a failure. We treat it as `{ found: false }` Final.
- **Defaults:** `timeoutMs: 10000, maxConcurrent: 8, cacheTtlSec: 86400`
- **Implementation:** `packages/providers/src/gravatar/`
- **Bruno:** `bruno/echo-api/lookups/create-gravatar.bru`

### 10. HIBP Pwned Passwords (`breach`)
- **Status:** implemented (P8a)
- **Integration pattern:** HTTP fetch (k-anonymity range API, no sidecar, no auth)
- **Source:** `https://api.pwnedpasswords.com/range/<sha1-prefix>`
- **What it does:** Validates a password against the breach corpus without ever sending the password (client-side SHA-1, only the first 5 hex chars cross the network).
- **Risks:** None for the user (password never leaves the process). Free tier is unmetered for the range API. SHA-1 is part of the protocol, not a security choice.
- **Defaults:** `timeoutMs: 10000, maxConcurrent: 8, cacheTtlSec: 21600`
- **Implementation:** `packages/providers/src/hibp/`
- **Bruno:** `bruno/echo-api/lookups/create-hibp.bru`

### 11. EmailRep (`email`)
- **Status:** implemented (P8a)
- **Integration pattern:** HTTP fetch (free unauth tier; optional `EMAILREP_API_KEY` for higher rate)
- **Source:** `https://emailrep.io/<email>` (Sublime Security)
- **What it does:** Email reputation + first-seen / last-seen / linked profile platforms. `reputation: "none"` is the "we know nothing" answer — surfaced as Final, not failure.
- **Risks:** rate-limited per IP on the unauthenticated tier; key activates a higher quota.
- **Defaults:** `timeoutMs: 10000, maxConcurrent: 4, cacheTtlSec: 43200`
- **Implementation:** `packages/providers/src/emailrep/`
- **Bruno:** `bruno/echo-api/lookups/create-emailrep.bru`

### 12. WhatsMyName (`username`)
- **Status:** implemented (P8a)
- **Integration pattern:** Own Node-native HTTP fan-out runner (~150 LOC) over the vendored CC-BY-SA-4.0 dataset
- **Source:** [`WebBreacher/WhatsMyName`](https://github.com/WebBreacher/WhatsMyName) — pinned commit `cf3346c5d41cbd3a6611db3c876d8fc5f17cbedd` (2026-05-04); dataset vendored as `packages/providers/src/whatsmyname/wmn-data.json` (732 sites).
- **What it does:** Username → list of sites where the handle is claimed, using each site's documented `e_string` / `m_string` heuristics. Ambiguous responses get skipped from the `checked` count.
- **Risks:** scrape-based — sites can change their detection markers without notice. Sites with `post_body` are filtered out before fan-out (POST requests with templated body are out of MVP scope).
- **Defaults:** `timeoutMs: 120000, maxConcurrent: 2, cacheTtlSec: 86400`
- **Implementation:** `packages/providers/src/whatsmyname/`
- **Bruno:** `bruno/echo-api/lookups/create-whatsmyname.bru`

### 13. phonenumbers (`phone`)
- **Status:** implemented (P8a)
- **Integration pattern:** Python sidecar (in-process libphonenumber; no subprocess)
- **Source:** [`daviddrysdale/python-phonenumbers`](https://github.com/daviddrysdale/python-phonenumbers) — Apache-2.0, pinned `phonenumbers==9.0.7`
- **What it does:** Phone number validation + region/country/carrier/line-type/geocoded-location/timezones. Invalid input returns `valid: false` + `parse_error` (Final, not a throw).
- **Risks:** None — fully offline, no network. Carrier coverage is uneven (UK fixed-line is often blank, EU mobile usually filled).
- **Defaults:** `timeoutMs: 5000, maxConcurrent: 16, cacheTtlSec: 2592000`
- **Implementation:** `packages/providers/src/phonenumbers/` + `services/echo-osint-py/app/phonenumbers_runner.py`
- **Bruno:** `bruno/echo-api/lookups/create-phonenumbers.bru` + `bruno/echo-api/sidecar/phonenumbers-run.bru`

### 14. socialscan (`username`)
- **Status:** implemented (P8a)
- **Integration pattern:** Python sidecar (subprocess + JSON file)
- **Source:** [`iojw/socialscan`](https://github.com/iojw/socialscan) — MPL-2.0, pinned `socialscan==2.0.1`
- **What it does:** Username/email availability check across ~10 platforms. Semantically opposite of Sherlock: `available=false` ⇒ handle is taken on that platform (a positive signal we surface as existence-elsewhere).
- **Risks:** library writes JSON to a file rather than streaming; we slurp after exit. 60s overall timeout. Platforms occasionally rotate their availability endpoints.
- **Defaults:** `timeoutMs: 60000, maxConcurrent: 4, cacheTtlSec: 21600`
- **Implementation:** `packages/providers/src/socialscan/` + `services/echo-osint-py/app/socialscan_runner.py`
- **Bruno:** `bruno/echo-api/lookups/create-socialscan.bru` + `bruno/echo-api/sidecar/socialscan-run.bru`

### 15. telegram-resolve (`phone`) — env-conditional
- **Status:** implemented scaffold (P8a) — activates only with TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION_PATH
- **Integration pattern:** Python sidecar (Telethon MTProto client)
- **Source:** [`Lonami/Telethon` on Codeberg](https://codeberg.org/Lonami/Telethon) — MIT, pinned `telethon==1.39.0`. The GitHub mirror was archived 2026-02; the project moved to Codeberg, PyPI publication unaffected.
- **What it does:** Phone → Telegram profile via `ImportContacts → GetFullUser → DeleteContacts` (we don't keep the contact in the session). Privacy-respecting users with `Who can find me by phone = My Contacts` return `found_on_telegram: false`.
- **Risks:** Telethon rate-limit ~100-200 resolve/sec per account before `FLOOD_WAIT`; we own one disposable SIM per provisioned account. Without env creds the provider returns `configured: false` + an instructive error pointing at RUNBOOK.
- **ToS:** formally not violated — MTProto is the standard user API. Grey area: ResolvePhone adds a contact-book entry on our side; we always delete it.
- **Defaults:** `timeoutMs: 30000, maxConcurrent: 2, cacheTtlSec: 21600`
- **Implementation:** `packages/providers/src/telegram-resolve/` + `services/echo-osint-py/app/telegram_runner.py`
- **Bruno:** `bruno/echo-api/lookups/create-telegram-resolve.bru` + `bruno/echo-api/sidecar/telegram-resolve-run.bru`

### 16. truecaller (`phone`) — env-conditional
- **Status:** implemented scaffold (P8a) — activates only with TRUECALLER_INSTALLATION_ID; **smoke-test on first activation** ([p8-final-plan REV-3 § 4](./research/p8-final-plan-2026-05-19-ru.md))
- **Integration pattern:** Python sidecar (truecallerpy unofficial wrapper)
- **Source:** [`sumithemmadi/truecallerpy`](https://github.com/sumithemmadi/truecallerpy) — Python MIT, pinned `truecallerpy==0.1.6`. Library is ~2 years stale (last code-commit 2024-05-04); first checkin of P8b should verify the login flow still works.
- **What it does:** Phone → name / image / spam-score / linked emails as Truecaller's crowd-sourced network has them.
- **Risks:** unofficial library, Truecaller can rotate auth schema or ban the linked account. FLOOD_WAIT / HTTP 4xx errors surface as Final with `error: "..."`, not as throws — the rest of the pipeline keeps running.
- **ToS:** violated (not-public API). UI must label this result as "crowd-sourced from Truecaller".
- **Defaults:** `timeoutMs: 25000, maxConcurrent: 2, cacheTtlSec: 21600`
- **Implementation:** `packages/providers/src/truecaller/` + `services/echo-osint-py/app/truecaller_runner.py`
- **Bruno:** `bruno/echo-api/lookups/create-truecaller.bru` + `bruno/echo-api/sidecar/truecaller-run.bru`

### 17. PhoneInfoga (`phone`) — full implementation (was status `planned` since P1)
- **Status:** implemented (P8a)
- **Integration pattern:** Python sidecar wrapping the Go binary (subprocess + tmp JSON file)
- **Source:** [`sundowndev/phoneinfoga`](https://github.com/sundowndev/phoneinfoga) — Go GPL-3.0, pinned binary v2.11.0 (amd64). arm64 deployments need a per-arch Dockerfile change.
- **What it does:** Local-scanner metadata (country/carrier/line type) + a list of ready-to-click Google dork URLs the UI surfaces as "search for this number on Facebook/LinkedIn/pastebins".
- **Defaults:** `timeoutMs: 30000, maxConcurrent: 4, cacheTtlSec: 604800`
- **Implementation:** `packages/providers/src/phoneinfoga/` + `services/echo-osint-py/app/phoneinfoga_runner.py`
- **Bruno:** `bruno/echo-api/lookups/create-phoneinfoga.bru` + `bruno/echo-api/sidecar/phoneinfoga-run.bru`

### 18. socid-extractor (`username`) — P8b
- **Status:** implemented (P8b, 2026-05-19)
- **Integration pattern:** Python sidecar (in-process; sidecar fetches via httpx, then `socid_extractor.extract()` on a worker thread)
- **Source:** [`soxoj/socid-extractor`](https://github.com/soxoj/socid-extractor) — Python MIT, pinned `socid-extractor==0.0.28`
- **What it does:** URL → site-specific identifiers (Telegram user_id, VK profile id, GitHub commit emails, Patreon ids, …). ~130 site-specific parsers covering the long tail of social handles. Designed as a post-processor for Sherlock/Maigret hits.
- **Risks:** parser drift when sites change their HTML. Stringified Python lists (`"['a', 'b']"`) for fields like `links` are normalised back into real arrays via `ast.literal_eval`.
- **Defaults:** `timeoutMs: 20000, maxConcurrent: 4, cacheTtlSec: 43200`
- **Implementation:** `packages/providers/src/socid-extractor/` + `services/echo-osint-py/app/socid_extractor_runner.py`
- **Bruno:** `bruno/echo-api/lookups/create-socid-extractor.bru` + `bruno/echo-api/sidecar/socid-extractor-run.bru`

### 19. ignorant (`phone`) — P8c
- **Status:** implemented (P8c, 2026-05-19)
- **Integration pattern:** Python sidecar (subprocess + stdout JSON parsing — GPL-3.0 so we keep it at the binary boundary)
- **Source:** [`megadose/ignorant`](https://github.com/megadose/ignorant) — Python GPL-3.0, pinned `ignorant==1.2`
- **What it does:** Phone → social-presence check on Instagram / Snapchat / Amazon. `exists: true` ⇒ the number is registered on that platform.
- **Risks:** ~10 months staleness as of 2026-05; Megadose tools usually keep working but require monitoring. Input format requires country dialling code WITHOUT the `+` and digits-only national-significant number.
- **Defaults:** `timeoutMs: 30000, maxConcurrent: 2, cacheTtlSec: 21600`
- **Implementation:** `packages/providers/src/ignorant/` + `services/echo-osint-py/app/ignorant_runner.py`
- **Bruno:** `bruno/echo-api/lookups/create-ignorant.bru` + `bruno/echo-api/sidecar/ignorant-run.bru`

### 20. GHunt (`email`) — env-conditional, P8c
- **Status:** implemented (P8c, 2026-05-19) — activates only with `GHUNT_CREDS_PATH` set to a present `creds.m` file produced by `ghunt login`
- **Integration pattern:** Python sidecar (subprocess + tmp JSON file — AGPL-3.0 so we keep it at the binary boundary)
- **Source:** [`mxrch/GHunt`](https://github.com/mxrch/GHunt) — AGPL-3.0, pinned `ghunt==2.3.3`
- **What it does:** Email → Google profile (real name, gaia_id, profile picture, Maps reviews count, calendar visibility). Often the single highest-value email→identity bridge in OSINT.
- **AGPL nuance:** AGPL §13 (network clause) doesn't trigger because we don't modify GHunt. Unmodified upstream invoked as a subprocess counts as "mere aggregation".
- **Risks:** stale Google cookies → 401 in stderr; re-run `ghunt login`. Subprocess errors land in `error` with `configured: true` rather than throwing.
- **Defaults:** `timeoutMs: 60000, maxConcurrent: 2, cacheTtlSec: 43200`
- **Implementation:** `packages/providers/src/ghunt/` + `services/echo-osint-py/app/ghunt_runner.py`
- **Bruno:** `bruno/echo-api/lookups/create-ghunt.bru` + `bruno/echo-api/sidecar/ghunt-run.bru`

### 21. mailcat (`username` → emails) — env-conditional, P8c
- **Status:** implemented scaffold (P8c, 2026-05-19) — activates only with `MAILCAT_INSTALL_PATH` pointing at a clone of `sharsil/mailcat` whose `requirements.txt` has been installed (typically a docker-compose volume mount)
- **Integration pattern:** Python sidecar (subprocess on a manually-provisioned script repo + `[+]` / `[-]` line parsing)
- **Source:** [`sharsil/mailcat`](https://github.com/sharsil/mailcat) — Apache-2.0 (~22 email providers checked)
- **What it does:** Username → existing email addresses across the common providers (Gmail, ProtonMail, Outlook, etc.). Sidecar streams Partial per `exists: true` hit; Final's `found` array is the convenience slice.
- **Why env-conditional and not baked into the image:** upstream depends on pyppeteer + Chromium (~250 MB). Bakeing that into the default sidecar image is too heavy for a single provider; the env-conditional pattern lets the operator opt in by mounting a manually-installed clone.
- **Defaults:** `timeoutMs: 90000, maxConcurrent: 2, cacheTtlSec: 43200`
- **Implementation:** `packages/providers/src/mailcat/` + `services/echo-osint-py/app/mailcat_runner.py`
- **Bruno:** `bruno/echo-api/lookups/create-mailcat.bru` + `bruno/echo-api/sidecar/mailcat-run.bru`

### 22. SauceNAO (`image`) — P8d
- **Status:** implemented (P8d, 2026-05-19)
- **Integration pattern:** Node-native HTTP fetch — no sidecar dependency. Optional `SAUCENAO_API_KEY` env bumps the unauth 100/day to 200/day.
- **Source:** SauceNAO REST API at `https://saucenao.com/search.php`
- **What it does:** Pixel-similarity reverse image search across Pixiv / Twitter / Mastodon / Danbooru / Anidb / etc. **Not face recognition** — stays out of the biometrics regime.
- **Risks:** rate-limited per IP on unauth tier. Matches below the default 60-similarity threshold are filtered out at the runtime edge.
- **Defaults:** `timeoutMs: 15000, maxConcurrent: 2, cacheTtlSec: 604800`
- **Implementation:** `packages/providers/src/saucenao/`
- **Bruno:** `bruno/echo-api/lookups/create-saucenao.bru`

### 23. ExifTool (`image`) — P8d, supersedes `exifr`
- **Status:** implemented (P8d, 2026-05-19) — supersedes the deferred `exifr` Phase 1 starter
- **Integration pattern:** Python sidecar (subprocess on the `libimage-exiftool-perl` Debian package; AGPL-clean `mere aggregation`)
- **Source:** [`exiftool/exiftool`](https://exiftool.org/) — GPL-3.0 + Artistic dual-licensed, installed via `apt-get install libimage-exiftool-perl` in the sidecar Dockerfile
- **What it does:** Downloads the image URL into a sidecar tmp file (32 MiB cap) then runs `exiftool -json -G -fast2` on it. Output is slimmed to a fixed allowlist: camera make/model/lens, GPS lat/lon/alt, IPTC byline/credit, XMP creator/rights — nothing else.
- **Risks:** Image fetches respect a 32 MiB cap; oversize/inaccessible images land in `error` not 5xx. GPS coords arrive in ExifTool's native string format (`37 deg 24' 35.40" N`); the UI parses if it wants numeric.
- **Defaults:** `timeoutMs: 30000, maxConcurrent: 4, cacheTtlSec: 300`
- **Implementation:** `packages/providers/src/exiftool/` + `services/echo-osint-py/app/exiftool_runner.py`
- **Bruno:** `bruno/echo-api/lookups/create-exiftool.bru` + `bruno/echo-api/sidecar/exiftool-run.bru`

---

## Verified deferred candidates (queue for Phase 1.5+)

> ⚠️ Status `planned-unverified` until someone re-verifies via `api.github.com`. Use the verification one-liner at the bottom.

### Domain / DNS
- **Amass** (`owasp-amass/amass`, Go) — heavy but exhaustive; revisit when Subfinder is insufficient.
- **theHarvester** (`laramies/theHarvester`, Python) — emails/subdomains/hosts; overlaps with Subfinder + future email tools.
- **dnstwist** — typo-squat domain enumeration; niche but valuable for brand-monitoring workflows.

### Social
- **Reddit (snoowrap)** (Node) — official API still has free tier with rate limits; useful and not ban-prone.
- **Instagram (instaloader)** (Python) — works for public profiles but Meta bans aggressively; **defer until proxy infra exists**.

### Crypto / blockchain
- **Etherscan API** — free tier with key.
- **mempool.space, blockstream.info** — free public APIs for BTC.
- **OFAC sanctions list** — free downloadable file.

### Tech fingerprinting
- **Wappalyzer dataset** (`enthec/webappanalyzer` since the original went closed-source 2023) — use the JSON dataset from a Node-native detector.
- **httpx** (`projectdiscovery/httpx`, Go) — HTTP probing with tech detection; same publisher as Subfinder so likely actively maintained.

### Hosted free-tier APIs
- **Shodan** — "free tier" is essentially marketing; one query/credit, expensive.
- **Censys** — free tier with key; better signal than Shodan free tier for our needs.
- **EmailRep.io** — reputation scoring for emails; key required.

---

## Confirmed dead / do-not-adopt

- **Twitter/X scraping (snscrape, twint)** — broken since 2023 API changes. Skip permanently unless we pay for X API.
- **Wappalyzer (original)** — went closed-source 2023; use the OSS fork (above).
- **TikTok-Api** — breaks monthly; not worth the maintenance.
- **Maltego CE** — Java GUI; no headless backend integration possible in CE tier.

---

## Honest gaps — categories with no good free option in 2026

These will likely be **paid-only** if we ever offer them. We should not lie about it in the UI.

- **Breach / leak data** — HIBP requires paid API; DeHashed/LeakCheck/Snusbase all paid. HIBP free tier is password-hash-only (k-anonymity).
- **Reverse image search** — Google/Bing/Yandex/TinEye all blocked or paid for programmatic use.
- **People search / public records** — Pipl, Spokeo, BeenVerified all paid.
- **Premium Twitter/X data** — paid via API or third parties.

---

## Verification one-liner

To verify a repo's status before adopting (no tools beyond `curl` needed; works in CI):

```bash
curl -s "https://api.github.com/repos/<owner>/<repo>" \
  | jq '{ stars: .stargazers_count, last_push: .pushed_at, archived, license: .license.spdx_id, branch: .default_branch }'
```

If `pushed_at` is more than 12 months stale, mark the candidate `planned-stale` and look for a maintained fork.

---

## Provider categorization (drives API contract)

Allowed `category` values on `OsintProvider`:

`username`, `email`, `phone`, `domain`, `ip`, `breach`, `image`, `social`, `crypto`, `tech`, `people`, `meta`

These drive metric labeling and OpenAPI grouping.

---

## How to add a new provider

See [P8 in `AGENT_PLAN.md`](./AGENT_PLAN.md#p8--provider-catalog-rollout). High-level:

1. Verify the upstream tool is alive (one-liner above; or check the GitHub page directly).
2. Choose the integration pattern (Node-native, Python sidecar, CLI, hosted API).
3. Implement the `OsintProvider` interface (or add to the Python sidecar with the equivalent contract).
4. Define `inputSchema` and `outputSchema` carefully — they become public API.
5. Pass the conformance test suite (`@echo/providers/core/conformance.ts`).
6. Add a Bruno request hitting it with real input.
7. Document it in this file (move to the right status with verified facts).
8. Add to the registry; ship.
