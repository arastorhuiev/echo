import { Module } from "@nestjs/common"
import { TerminusModule } from "@nestjs/terminus"
import { HealthController } from "@/health/health.controller"
import { PostgresHealthIndicator } from "@/health/postgres.health-indicator"
import { RedisHealthIndicator } from "@/health/redis.health-indicator"
import { SidecarHealthIndicator } from "@/health/sidecar.health-indicator"

/**
 * DbModule and RedisModule are global (from @echo/nest), so they
 * don't need to be re-imported here — `DB_CLIENT` and `REDIS` tokens
 * resolve from the global registry.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PostgresHealthIndicator, RedisHealthIndicator, SidecarHealthIndicator],
})
export class HealthModule {}
