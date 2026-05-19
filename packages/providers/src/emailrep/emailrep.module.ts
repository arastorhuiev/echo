import { type DynamicModule, Module } from "@nestjs/common"
import { createEmailrepProvider } from "@/emailrep/emailrep.js"

export const EMAILREP_PROVIDER = Symbol.for("@echo/providers/EMAILREP_PROVIDER")

/**
 * No ConfigService injection yet — running on the free unauth tier.
 * When we want higher quota, add `inject: [ConfigService]` and read
 * EMAILREP_API_KEY here, passing it through to createEmailrepProvider.
 */
@Module({})
export class EmailrepProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: EmailrepProviderModule,
      providers: [
        {
          provide: EMAILREP_PROVIDER,
          useFactory: () => createEmailrepProvider(),
        },
      ],
      exports: [EMAILREP_PROVIDER],
    }
  }
}
