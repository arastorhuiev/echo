import { type AppConfigService, ConfigModule } from "@echo/config"
import { buildLoggerConfig } from "@echo/observability"
import { Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { LoggerModule as PinoLoggerModule } from "nestjs-pino"

@Module({
  imports: [
    ConfigModule,
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) =>
        buildLoggerConfig({
          nodeEnv: config.get("NODE_ENV"),
          logLevel: config.get("LOG_LEVEL"),
        }),
    }),
    // BullMQ consumers land here in P4.
  ],
})
export class AppModule {}
