import { type AppConfigService, ConfigModule } from "@echo/config"
import { buildLoggerConfig } from "@echo/observability"
import { forRootBullModule } from "@echo/queue"
import { Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { LoggerModule as PinoLoggerModule } from "nestjs-pino"
import { EchoDemoModule } from "@/echo-demo/echo.module"

const isProd = process.env.NODE_ENV === "production"

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
    forRootBullModule(),
    // Demo processor — only attached in non-prod, in line with the api side.
    // Real provider processors land in P5+.
    ...(isProd ? [] : [EchoDemoModule]),
  ],
})
export class AppModule {}
