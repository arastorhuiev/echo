import type { AppConfigService } from "@echo/config"
import { createDbClient, type DbClient } from "@echo/db/client"
import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { DB_CLIENT } from "@/db/tokens"

@Module({
  providers: [
    {
      provide: DB_CLIENT,
      useFactory: (config: AppConfigService): DbClient =>
        createDbClient(config.get("DATABASE_URL")),
      inject: [ConfigService],
    },
  ],
  exports: [DB_CLIENT],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_CLIENT) private readonly client: DbClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.close()
  }
}
