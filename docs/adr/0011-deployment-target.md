# 0011. Deployment target — Hetzner CCX

**Status:** Accepted
**Date:** 2026-05-14

## Context

We need EU-based hosting (target markets: Ukraine, USA, Europe), good price/performance, predictable monthly cost, and minimal ops complexity for a solo maintainer. The original PROMPT.md listed Hetzner / Contabo / Cloudflare as candidates. Cloudflare is incompatible — Workers can't run NestJS or a Python sidecar. Contabo is cheaper but historically less reliable than Hetzner. The user confirmed budget flexibility up to ~€50/mo.

## Decision

- **Provider:** Hetzner Cloud.
- **Phase 1 box:** CCX13 (€16/mo: 2 dedicated vCPU, 8 GB RAM, 80 GB SSD, 20 TB traffic).
- **Upgrade path within Hetzner:**
  - **CCX23** (~€31/mo, 4 vCPU, 16 GB) when Phase 1 saturates.
  - **CCX33** (~€60/mo, 8 vCPU, 32 GB) for headroom.
  - Above CCX33 → split workload across multiple boxes; the architecture supports this without code change.
- **Region:** Helsinki or Falkenstein (EU jurisdiction; lowest latency to EU users; reasonable for US/UA).
- **Orchestration:** Docker Compose (no Kubernetes). Single host; `docker compose up -d`.
- **Reverse proxy / TLS:** Caddy (auto-TLS via Let's Encrypt).
- **CDN / DNS:** Cloudflare (free tier) in front for DNS, edge cache, WAF, Turnstile.
- **Storage / backups:** Hetzner snapshots weekly + nightly `pg_dump` to Backblaze B2 (or Hetzner Object Storage).
- **Provisioning:** documented manual setup script today; Terraform module added in P11 for reproducibility.

## Consequences

**Good:**
- Cheap, predictable cost; clear scaling ladder without changing provider.
- EU jurisdiction (relevant if/when GDPR posture matters in Phase 3+).
- Dedicated CPU on CCX line — important when Sherlock + worker + Postgres + Redis share a box.
- Hetzner snapshots + B2 backups give a real DR story.
- Docker Compose is debuggable by one person; no k8s control plane to maintain.

**Bad:**
- Single-host SPOF until we split. Mitigation: Hetzner snapshots + tested restore path; planned multi-box config in Phase 2.
- Manual ops (vs managed PaaS like Fly.io, Render). Acceptable cost given the savings.
- No Anycast — geographic latency mitigated by Cloudflare CDN for assets.

## Alternatives considered

- **Contabo VPS** — cheaper, but uneven reliability and slower I/O than Hetzner CCX. Not worth the savings at this scale.
- **AWS / GCP / Azure** — overkill, expensive, vendor lock for things we don't need.
- **Fly.io** — global edge is nice but per-second billing is unpredictable; vendor lock; worse fit for the Python sidecar.
- **Cloudflare Workers / Pages backend** — Workers can't run NestJS or Python; Pages is frontend only.
- **Supabase / Neon for managed Postgres** — would be fine; we'd add later if managed Postgres becomes more useful than a self-hosted one.

## Triggers to reconsider

- Single-box saturation past CCX33 → split to API box + worker box + DB box (Phase 2 of [`ARCHITECTURE.md`](../ARCHITECTURE.md)).
- Need for multi-region presence → introduce edge presence via Cloudflare Workers as a passthrough or move to Fly.io.
- Hetzner availability incident → revisit DR posture and consider warm standby on a second provider.
