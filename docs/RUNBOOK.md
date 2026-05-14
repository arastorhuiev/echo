# Runbook

> Operational quick reference. Pre-implementation: this document is mostly a skeleton with the right *headings* so future-you knows where to put things. Each section will be filled in as the corresponding phase of [`AGENT_PLAN.md`](./AGENT_PLAN.md) lands.

## Local development

### First-time setup
```bash
# Install Node 24 LTS (use nvm or volta)
nvm use            # picks up .nvmrc once P0 lands

# Install pnpm 10
corepack enable
corepack prepare pnpm@latest --activate

# Install deps
pnpm install

# Bring up the local stack
docker compose up -d postgres redis    # P1
docker compose up -d osint-py          # P7

# Run migrations
pnpm -F @echo/db migrate:dev           # P2

# Start the API and worker (each in its own terminal)
pnpm -F @echo/api dev
pnpm -F @echo/worker dev
```

### Common commands
- `pnpm check` — lint + typecheck + test (the gate before pushing).
- `pnpm -r build` — build everything.
- `pnpm -F @echo/<pkg> test` — run one package's tests.
- `docker compose down -v` — nuke local state (Postgres + Redis volumes deleted).

## Production deployment

*To be populated in P11.* Skeleton:

- **Host:** Hetzner CCX13 (initial), see [ADR-0011](./adr/0011-deployment-target.md).
- **Domain:** `api.echo.<domain>` → Cloudflare proxy → origin via Caddy.
- **Secrets:** `/etc/echo/.env` (root-owned, 600). Never in git.
- **Deploy:** GitHub Actions `deploy.yml` (merge to `main` → manual approve → SSH → `docker compose pull && up -d`).
- **Rollback:** redeploy the previous image tag — `docker compose -f docker-compose.prod.yml pull <previous-sha>` then `up -d --force-recreate`.

## Monitoring & alerts

*To be populated in P10.* Skeleton:

- Metrics endpoint: `https://api.echo.<domain>/api/metrics` (Prometheus exposition; allowlist by IP).
- Traces: OTLP exporter to Grafana Cloud (or self-hosted Tempo).
- Logs: stdout → Docker JSON driver → ship to Loki via Promtail.
- Dashboards: `ops/grafana/echo.json`.
- Alerts to wire (suggested):
  - Any provider's breaker state == open for > 5 min.
  - p95 lookup duration > 30 s for any provider.
  - Daily provider cost counter > threshold.
  - Postgres connections > 80% pool size.
  - Redis memory > 80%.

## Common operations

### Reset a stuck circuit breaker

*To be populated in P9.* Likely:
```bash
# Connect to the API container
docker compose exec api node -e "
  /* call providers repository to reset breaker_state to 'closed' */
"
# Or directly in DB:
psql $DATABASE_URL -c "UPDATE providers SET breaker_state='closed', breaker_opened_at=NULL WHERE id='<provider>';"
```

### Drain the worker for maintenance
*To be populated.*

### Replay a failed lookup
*To be populated.*

### Add a new OSINT provider
*To be populated in P8.* Cross-reference the provider how-to that lands with that phase.

### Backup / restore
*To be populated in P11.* `pg_dump` → B2 / Hetzner Object Storage; restore is `pg_restore` into a fresh DB.

## Incident playbook

*To be populated.* Skeleton:

- **API returning 503s for one provider** → check breaker state, check provider's external dependency status.
- **API returning 503s for all providers** → check Redis health, check BullMQ queue lengths.
- **Worker not consuming jobs** → check worker container is up; check Redis connection; check for stuck active jobs (`bull:q.<id>:active`).
- **Database connection storm** → check pgBouncer / connection pool sizing; restart API.
- **Sherlock sidecar OOM** → restart `osint-py`; investigate which Python tool leaked; consider per-tool memory limits in compose.

## Useful one-liners

```bash
# How many lookups in the last hour?
psql $DATABASE_URL -c "SELECT provider_id, status, COUNT(*) FROM lookups WHERE created_at > NOW()-interval '1 hour' GROUP BY 1,2;"

# Peek at queue lengths
redis-cli LLEN bull:q.sherlock:wait
redis-cli LLEN bull:q.sherlock:active

# Tail container logs
docker compose logs -f api worker --tail=200
```

## On-call expectations

Solo project. There is no formal on-call. When the project gets users:
- Set Cloudflare uptime checks → email alerts.
- Set Grafana alerts → Telegram/email.
- Document an escalation path (currently: nobody — fix it yourself).
