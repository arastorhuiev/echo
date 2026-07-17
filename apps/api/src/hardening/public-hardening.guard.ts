import type { AppConfigService } from "@echo/config"
import { REDIS } from "@echo/nest"
import { OsintProviderRegistry } from "@echo/providers"
import { costDay, providerCostKey } from "@echo/queue"
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { Redis } from "ioredis"
import {
  isBackpressured,
  isOverCostCap,
  isRateLimited,
  minuteBucket,
} from "@/hardening/hardening.decisions"
import { QueueRouter } from "@/lookups/queue-router"

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
const RATE_LIMIT_WINDOW_SEC = 60
const RETRY_AFTER_SEC = 60

/**
 * Exposure-only public hardening (P9-pub), applied to the public POST routes
 * only. Every check is DEFAULT-OFF (its env knob is 0 / empty) so local dev
 * and CI are never throttled; production flips them on just before P11.
 * Order: cheapest/most-abusive first — Turnstile → rate-limit → backpressure
 * → cost-cap.
 */
@Injectable()
export class PublicHardeningGuard implements CanActivate {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ConfigService) private readonly config: AppConfigService,
    private readonly registry: OsintProviderRegistry,
    private readonly queues: QueueRouter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp()
    const req = http.getRequest<FastifyRequest>()
    const reply = http.getResponse<FastifyReply>()

    await this.assertTurnstile(req)
    await this.assertRateLimit(req)
    await this.assertBackpressure(reply)
    await this.assertCostCap(reply)
    return true
  }

  private async assertTurnstile(req: FastifyRequest): Promise<void> {
    const secret = this.config.get("TURNSTILE_SECRET")
    if (!secret) return
    const token = this.turnstileToken(req)
    if (!token || !(await this.verifyTurnstile(secret, token, req.ip))) {
      throw new ForbiddenException({ error: "TurnstileFailed" })
    }
  }

  private async assertRateLimit(req: FastifyRequest): Promise<void> {
    const limit = this.config.get("RATE_LIMIT_PER_MINUTE")
    if (limit <= 0) return
    const key = `ratelimit:${req.ip}:${minuteBucket(Date.now())}`
    const count = await this.redis.incr(key)
    if (count === 1) await this.redis.expire(key, RATE_LIMIT_WINDOW_SEC)
    if (isRateLimited(count, limit)) {
      throw new HttpException(
        { error: "RateLimited", limitPerMinute: limit },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  private async assertBackpressure(reply: FastifyReply): Promise<void> {
    const max = this.config.get("QUEUE_BACKPRESSURE_MAX")
    if (max <= 0) return
    const counts = await this.queues.jobCounts().catch(() => ({}))
    const totalWaiting = Object.values(counts).reduce((sum, c) => sum + Number(c.waiting ?? 0), 0)
    if (isBackpressured(totalWaiting, max)) {
      reply.header("Retry-After", String(RETRY_AFTER_SEC))
      throw new HttpException({ error: "QueueBackpressure" }, HttpStatus.SERVICE_UNAVAILABLE)
    }
  }

  private async assertCostCap(reply: FastifyReply): Promise<void> {
    const cap = this.config.get("COST_DAILY_CAP")
    if (cap <= 0) return
    const ids = this.registry.ids()
    if (ids.length === 0) return
    const day = costDay(new Date())
    const values = await this.redis.mget(ids.map((id) => providerCostKey(id, day))).catch(() => [])
    const totalToday = values.reduce((sum, v) => sum + (v != null ? Number(v) : 0), 0)
    if (isOverCostCap(totalToday, cap)) {
      reply.header("Retry-After", String(RETRY_AFTER_SEC))
      throw new HttpException({ error: "CostCapExceeded" }, HttpStatus.SERVICE_UNAVAILABLE)
    }
  }

  private turnstileToken(req: FastifyRequest): string | undefined {
    const header = req.headers["cf-turnstile-response"]
    if (typeof header === "string") return header
    const body = req.body as { turnstileToken?: unknown } | undefined
    return typeof body?.turnstileToken === "string" ? body.turnstileToken : undefined
  }

  private async verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
    try {
      const res = await fetch(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(3_000),
      })
      const data = (await res.json()) as { success?: boolean }
      return data.success === true
    } catch {
      return false
    }
  }
}
