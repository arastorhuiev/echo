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

- Register a Telegram app at <https://my.telegram.org> (free, ~30s).
  You get `api_id` (integer) and `api_hash` (hex string).
- One-time interactive Telethon login on your workstation:
  ```
  pip install telethon
  python -c "from telethon.sync import TelegramClient; \
      c = TelegramClient('echo.session', API_ID, 'API_HASH'); c.start(); c.disconnect()"
  ```
- Copy `echo.session` somewhere safe (e.g. `~/.echo/echo.session`).
- Add to `.env`:
  ```
  TELEGRAM_API_ID=...
  TELEGRAM_API_HASH=...
  TELEGRAM_SESSION_PATH=/path/to/echo.session
  ```
  Mount the session into the container if running via Docker (see
  `docker-compose.yml`).

### 2c. GHunt (`email → Google profile / Maps reviews`)

- One-time interactive login on your workstation:
  ```
  pip install ghunt
  ghunt login
  ```
  Follow the in-browser prompts. Use a **disposable** Google account.
  GHunt writes a `creds.m` file in `~/.config/ghunt/`.
- Add to `.env`:
  ```
  GHUNT_CREDS_PATH=/path/to/creds.m
  ```
  Mount the file into the container as a read-only volume if running via
  Docker.

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
