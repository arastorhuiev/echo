import { type DynamicModule, Module } from "@nestjs/common"
import { createHibpProvider } from "@/hibp/hibp.js"

export const HIBP_PROVIDER = Symbol.for("@echo/providers/HIBP_PROVIDER")

@Module({})
export class HibpProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: HibpProviderModule,
      providers: [
        {
          provide: HIBP_PROVIDER,
          useFactory: () => createHibpProvider(),
        },
      ],
      exports: [HIBP_PROVIDER],
    }
  }
}
