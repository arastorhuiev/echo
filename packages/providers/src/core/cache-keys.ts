/** Redis key for the cached `Final.data` value of a (provider, query) pair. */
export function providerResultCacheKey(providerId: string, queryHash: string): string {
  return `cache:result:${providerId}:${queryHash}`
}
