import type { OsintProvider } from "@/core/provider.js"
import { stubFailProvider } from "@/stubs/stub-fail.js"
import { stubSuccessProvider } from "@/stubs/stub-success.js"

export { stubFailProvider } from "@/stubs/stub-fail.js"
export { stubSuccessProvider } from "@/stubs/stub-success.js"

/**
 * Convenience array — both stub providers, in registration order.
 * AppModules pass this (or a superset) to OsintProviderRegistryModule.forRoot().
 *
 * Stubs stay registered in dev/test for end-to-end verification; in
 * production they should be omitted from the array.
 */
export const STUB_PROVIDERS: readonly OsintProvider[] = [stubSuccessProvider, stubFailProvider]
