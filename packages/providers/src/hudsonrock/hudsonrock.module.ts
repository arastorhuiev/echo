import { type DynamicModule, Module } from "@nestjs/common"
import { createHudsonRockProvider } from "@/hudsonrock/hudsonrock.js"

export const HUDSONROCK_PROVIDER = Symbol.for("@echo/providers/HUDSONROCK_PROVIDER")

@Module({})
export class HudsonRockProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: HudsonRockProviderModule,
      providers: [
        {
          provide: HUDSONROCK_PROVIDER,
          useFactory: () => createHudsonRockProvider(),
        },
      ],
      exports: [HUDSONROCK_PROVIDER],
    }
  }
}
