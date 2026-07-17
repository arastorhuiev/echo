import type { AppConfigService } from "@echo/config"
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { bearerTokenValid } from "@/admin/admin-auth"

/**
 * Guards every `/admin/*` JSON route (P13). Requires
 * `Authorization: Bearer <ADMIN_TOKEN>`, compared in constant time. The
 * Bull-Board UI at `/admin/queues` is mounted outside Nest routing and is
 * protected separately by a Fastify preHandler (see main.ts) — a Nest guard
 * can't reach a route Nest doesn't own.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  // See SidecarHealthIndicator for why AppConfigService needs @Inject.
  constructor(@Inject(ConfigService) private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>()
    if (!bearerTokenValid(req.headers.authorization, this.config.get("ADMIN_TOKEN"))) {
      throw new UnauthorizedException({ error: "AdminUnauthorized" })
    }
    return true
  }
}
