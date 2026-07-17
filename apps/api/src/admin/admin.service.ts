import type { AppConfigService } from "@echo/config"
import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import { DB_CLIENT, REDIS } from "@echo/nest"
import { breakerKeys, OsintProviderRegistry } from "@echo/providers"
import { costDay, providerCostKey } from "@echo/queue"
import { Inject, Injectable, NotFoundException } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type { Redis } from "ioredis"
import { QueueRouter } from "@/lookups/queue-router"

type UpDown = "up" | "down"

/**
 * Read/act backend for the ops cockpit (P13). Assembles the live `/admin`
 * JSON — queue depth, breaker/health per provider, daily cost, recent
 * lookups — and applies the two D2 actionable toggles (enable/disable a
 * provider, reset a stuck breaker).
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly registry: OsintProviderRegistry,
    @Inject(ConfigService) private readonly config: AppConfigService,
    private readonly queues: QueueRouter,
  ) {}

  /** Live operational snapshot — everything the cockpit dashboard renders. */
  async status() {
    const [health, queues, providers, cost, recentLookups] = await Promise.all([
      this.health(),
      this.queues.jobCounts().catch(() => ({})),
      this.providerSnapshots(),
      this.costToday(),
      repositories.lookups.recent(this.dbClient.db, 50).catch(() => []),
    ])
    const mem = process.memoryUsage()
    return {
      timestamp: new Date().toISOString(),
      health,
      // The api process only — worker/sidecar container RSS is exposed via
      // their own /metrics + Bull-Board, not reachable from this process.
      process: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed },
      queues,
      providers,
      cost,
      recentLookups,
    }
  }

  /** Effective (non-secret) config: env knobs + per-provider enabled/breaker/caps. */
  async effectiveConfig() {
    return {
      env: {
        NODE_ENV: this.config.get("NODE_ENV"),
        LOG_LEVEL: this.config.get("LOG_LEVEL"),
        PORT: this.config.get("PORT"),
        OSINT_PY_URL: this.config.get("OSINT_PY_URL"),
        OTEL_SERVICE_NAME: this.config.get("OTEL_SERVICE_NAME"),
        OTEL_EXPORTER_OTLP_ENDPOINT: this.config.get("OTEL_EXPORTER_OTLP_ENDPOINT") ?? null,
        METRICS_ALLOWLIST: this.config.get("METRICS_ALLOWLIST") ?? null,
        COST_DAILY_WARN: this.config.get("COST_DAILY_WARN"),
      },
      // DATABASE_URL / REDIS_URL / ADMIN_TOKEN are secrets — never exposed.
      providers: await this.providerSnapshots(),
    }
  }

  /** Enable/disable a provider (D2 load-shed toggle). 404 for an unknown id. */
  async setProviderEnabled(id: string, enabled: boolean) {
    this.assertKnownProvider(id)
    await repositories.providers.setEnabled(this.dbClient.db, id, enabled)
    return { id, enabled }
  }

  /**
   * Force a stuck breaker back to closed (D2). 404 for an unknown id.
   *
   * The LIVE breaker state machine lives in Redis (`breaker:<id>:*`) and is
   * what `run()` gates on — the Postgres row is only a mirror. So clear the
   * Redis keys FIRST (that's the real reset), then update the mirror.
   * Deleting the state key ⇒ the breaker reads as closed on the next run.
   */
  async resetBreaker(id: string) {
    this.assertKnownProvider(id)
    const keys = breakerKeys(id)
    await this.redis.del(keys.state, keys.failures, keys.openedAt)
    await repositories.providers.resetBreaker(this.dbClient.db, id)
    return { id, breakerState: "closed" as const }
  }

  private assertKnownProvider(id: string): void {
    if (!this.registry.get(id)) {
      throw new NotFoundException({ error: "UnknownProvider", providerId: id })
    }
  }

  /** Merge the registry (all ids + caps) with persisted rows (enabled + breaker). */
  private async providerSnapshots() {
    const rows = await repositories.providers.list(this.dbClient.db).catch(() => [])
    const byId = new Map(rows.map((r) => [r.id, r]))
    return this.registry.list().map((p) => {
      const row = byId.get(p.id)
      return {
        id: p.id,
        category: p.category,
        enabled: row?.enabled ?? true,
        breakerState: row?.breakerState ?? "closed",
        breakerOpenedAt: row?.breakerOpenedAt ?? null,
        lastSuccessAt: row?.lastSuccessAt ?? null,
        lastFailureAt: row?.lastFailureAt ?? null,
        maxConcurrent: p.defaults.maxConcurrent,
        timeoutMs: p.defaults.timeoutMs,
        cacheTtlSec: p.defaults.cacheTtlSec,
        ratePerSec: p.defaults.ratePerSec ?? null,
      }
    })
  }

  private async health(): Promise<{ postgres: UpDown; redis: UpDown; sidecar: UpDown }> {
    const [postgres, redis, sidecar] = await Promise.all([
      repositories.providers
        .list(this.dbClient.db)
        .then((): UpDown => "up")
        .catch((): UpDown => "down"),
      this.redis
        .ping()
        .then((): UpDown => "up")
        .catch((): UpDown => "down"),
      this.sidecarHealth(),
    ])
    return { postgres, redis, sidecar }
  }

  private async sidecarHealth(): Promise<UpDown> {
    try {
      const url = this.config.get("OSINT_PY_URL").replace(/\/+$/, "")
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })
      return res.ok ? "up" : "down"
    } catch {
      return "down"
    }
  }

  private async costToday(): Promise<Record<string, number>> {
    const ids = this.registry.ids()
    if (ids.length === 0) return {}
    const day = costDay(new Date())
    const values = await this.redis.mget(ids.map((id) => providerCostKey(id, day))).catch(() => [])
    const out: Record<string, number> = {}
    ids.forEach((id, i) => {
      const v = values[i]
      if (v != null) out[id] = Number(v)
    })
    return out
  }
}
