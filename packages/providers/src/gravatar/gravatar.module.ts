import { type DynamicModule, Module } from "@nestjs/common"
import { createGravatarProvider } from "@/gravatar/gravatar.js"

export const GRAVATAR_PROVIDER = Symbol.for("@echo/providers/GRAVATAR_PROVIDER")

/**
 * Provider has no env-driven config (public unauthenticated API), so the
 * module factory takes no inject deps. Keeping it as a DynamicModule for
 * consistency with the other provider modules — easy to grow into config
 * injection later (e.g. when paid-tier API key gets added).
 */
@Module({})
export class GravatarProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: GravatarProviderModule,
      providers: [
        {
          provide: GRAVATAR_PROVIDER,
          useFactory: () => createGravatarProvider(),
        },
      ],
      exports: [GRAVATAR_PROVIDER],
    }
  }
}
