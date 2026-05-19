import { type DynamicModule, Module } from "@nestjs/common"
import { createWhatsmynameProvider } from "@/whatsmyname/whatsmyname.js"

export const WHATSMYNAME_PROVIDER = Symbol.for("@echo/providers/WHATSMYNAME_PROVIDER")

@Module({})
export class WhatsmynameProviderModule {
  static forRoot(): DynamicModule {
    return {
      module: WhatsmynameProviderModule,
      providers: [
        {
          provide: WHATSMYNAME_PROVIDER,
          useFactory: () => createWhatsmynameProvider(),
        },
      ],
      exports: [WHATSMYNAME_PROVIDER],
    }
  }
}
