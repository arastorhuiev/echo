# secrets/

Host-side home for **file-based OSINT provider credentials**. This whole
directory is mounted into the `osint-py` sidecar at `/secrets` (see
`docker-compose.yml`). Everything here except this README is git-ignored —
never commit a real credential.

| File | Provider | How it's created | Env var (in `.env.providers`) |
| --- | --- | --- | --- |
| `telegram.session` | `telegram-resolve` | `docker compose run --rm osint-py python -m app.telegram_login` | `TELEGRAM_SESSION_PATH=/secrets/telegram.session` |
| `.malfrats/ghunt/creds.m` | `ghunt` | `docker compose run --rm -e HOME=/secrets osint-py ghunt login` | none — auto-detected by file presence |

These files **are** the credentials and they are **portable**: mint them
once (anywhere), then to deploy on another host just copy this directory
across and `docker compose up -d` — no need to repeat any interactive login.

On a **Linux** server the sidecar runs as uid `1001`; if the container
can't write the session file, `chown -R 1001:1001 secrets` (or `chmod -R
g+w`). On macOS Docker Desktop this is handled by the file-sharing layer.

See `docs/OWNER_TODO.md` and `docs/RUNBOOK.md` for the full flow.
