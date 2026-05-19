import { type DynamicModule, Module } from "@nestjs/common"
import { createSaucenaoProvider } from "@/saucenao/saucenao.js"

export const SAUCENAO_PROVIDER = Symbol.for("@echo/providers/SAUCENAO_PROVIDER")

/**
 * SAUCENAO_API_KEY is read directly from `process.env` rather than via
 * ConfigService. It's an opt-in knob — empty / unset means "use the
 * unauth tier" (100 req/day per IP). Promoting it to the config schema
 * is a one-line change if we ever want startup validation.
 */
@Module({})
export class SaucenaoProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: SaucenaoProviderModule,
      providers: [
        {
          provide: SAUCENAO_PROVIDER,
          useFactory: () => createSaucenaoProvider({ apiKey: process.env.SAUCENAO_API_KEY }),
        },
      ],
      exports: [SAUCENAO_PROVIDER],
    }
  }
}
