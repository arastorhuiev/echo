# Owner TODO

> One-time owner actions that can't be automated (credential provisioning
> for env-conditional providers, etc.). Referenced from `docs/PROVIDERS.md`,
> `docs/DEVELOPMENT.md`, and `bruno/README.md`. Contains **no secrets** — only
> setup flows with placeholder values. Trim items as you complete them.

What I (Claude) couldn't do without your input. Each item is independent —
do them in any order, or skip the ones you don't want.

---

## 1. Test subject — already wired

I've already set the Bruno preset to the test triple you gave me:

| field | value |
| --- | --- |
| username | `efinswim` |
| email | `efinswim@gmail.com` |
| phone | `+48537529192` (PL) |

To switch the test subject in the future, edit `bruno/echo-api/environments/local.bru`
(the `testUsername` / `testEmail` / `testPhone` vars). All `create-*.bru`
requests pick them up automatically. Nothing to do here unless you want a
different target.

---

## 2. Env-conditional providers — credentials you may want to provision

These four providers are **free** but **env-conditional**. They each return
`configured: false` until you set the matching env var(s) in `.env`. The
provider scaffolds work, but I cannot prove the actual login flow with
upstream still works in 2026 until you've gone through it once. Pick the
ones you care about; the rest just stay dormant with no side-effects.

### 2a. Truecaller (`phone → identity + spam score`)

- Run on any workstation once:
  ```
  pip install truecallerpy
  truecallerpy --login
  ```
- Provide a disposable SIM, enter the OTP. Save the `installationId` it
  prints.
- Add to `.env`:
  ```
  TRUECALLER_INSTALLATION_ID=aXXX-XXXX-XXXX
  ```
- Restart the stack. Smoke-test via `bru run bruno/echo-api/sidecar/truecaller-run.bru --env local`.
- If the call returns `HTTP 401` — the installationId has been invalidated
  (upstream sometimes bans). Re-run the SMS login with a fresh SIM.

### 2b. Telegram resolve (`phone → Telegram profile`)

- Register a Telegram app at <https://my.telegram.org> (free, ~30s):
  **API development tools** → App title `echo backend`, Short name
  `echoapp` (≥5 chars), Platform **Desktop**, URL/Description blank.
  You get `api_id` (integer) and `api_hash` (hex string).
- Put the two values in `.env.providers`:
  ```
  TELEGRAM_API_ID=...
  TELEGRAM_API_HASH=...
  # TELEGRAM_SESSION_PATH is already set to /secrets/telegram.session
  ```
- Mint the session file once — interactive, but runs inside the sidecar
  (which already has Telethon), so nothing to `pip install`:
  ```
  docker compose run --rm osint-py python -m app.telegram_login
  ```
  Enter your phone number, then the login code Telegram sends you (+ 2FA
  password if you have one). The session lands at `./secrets/telegram.session`
  on the host — git-ignored, and mounted into the container automatically.
- The session file is **portable**: to deploy elsewhere, copy `./secrets`
  to the other host — you do *not* repeat this login there.

### 2c. GHunt (`email → Google profile / Maps reviews`)

- Mint the creds file once — interactive, but runs inside the sidecar
  (which already has GHunt installed), so nothing to `pip install`:
  ```
  docker compose run --rm -e HOME=/secrets osint-py ghunt login
  ```
  Use a **disposable** Google account, signed in on a real browser.
  GHunt's login menu offers 4 methods — **skip option [1]** ("Companion,
  listening mode"): it opens a local port for the browser extension to
  post to, which doesn't work through Docker. Pick **[2]** (install the
  [GHunt Companion](https://github.com/mxrch/ghunt_companion) browser
  extension, sign in as the disposable account, then paste the
  base64-encoded blob it gives you) or **[3]/[4]** (manually copy the
  `oauth_token` / `master_token` out of the browser's network tab —
  more fiddly, no extension needed).
- The creds land at `./secrets/.malfrats/ghunt/creds.m` on the host —
  git-ignored, mounted into the container automatically. Nothing to add
  to `.env.providers`; the provider auto-detects the file (GHunt
  hardcodes this path relative to `$HOME` with no override, so the
  runner points `HOME` at `/secrets` for every invocation).
- **Portable** like the Telegram session: to deploy elsewhere, copy
  `./secrets` to the other host — you do *not* repeat this login there.
- Stale cookies → `ghunt exited 1` with a 401 in the error text. Fix:
  `docker compose run --rm -e HOME=/secrets osint-py ghunt login --clean`
  (clears the old file so the login menu runs fresh), then log in again.

### 2d. mailcat (`username → likely email addresses`)

- Clone the upstream repo somewhere outside `echo/`:
  ```
  git clone https://github.com/sharsil/mailcat ~/tools/mailcat
  cd ~/tools/mailcat && pip install -r requirements.txt
  ```
- Add to `.env`:
  ```
  MAILCAT_INSTALL_PATH=/home/you/tools/mailcat
  ```
  Mount the directory into the container if running via Docker.

---

## 3. Decisions I deferred

None right now. If anything else needing your input comes up, I'll add it
here and ping you.

---

## How to verify after you've added envs

```
docker compose down
docker compose up -d --build
# In Bruno: open environments/local, run any of:
#   sidecar/truecaller-run.bru
#   sidecar/telegram-resolve-run.bru
#   sidecar/ghunt-run.bru
#   sidecar/mailcat-run.bru
# Each should return configured: true (and either found: true with data,
# or found: false with no error if the target genuinely isn't in their DB).
```
