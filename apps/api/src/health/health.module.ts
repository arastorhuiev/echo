import { Module } from "@nestjs/common"
import { TerminusModule } from "@nestjs/terminus"
import { DbModule } from "@/db/db.module"
import { HealthController } from "@/health/health.controller"
import { PostgresHealthIndicator } from "@/health/postgres.health-indicator"
import { RedisHealthIndicator } from "@/health/redis.health-indicator"
import { SidecarHealthIndicator } from "@/health/sidecar.health-indicator"
import { RedisModule } from "@/redis/redis.module"

@Module({
  imports: [TerminusModule, DbModule, RedisModule],
  controllers: [HealthController],
  providers: [PostgresHealthIndicator, RedisHealthIndicator, SidecarHealthIndicator],
})
export class HealthModule {}
