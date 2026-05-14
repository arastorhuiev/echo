/**
 * BullMQ job payload for the generic `q.lookup` queue. Producers
 * (apps/api LookupsService) and consumers (apps/worker LookupProcessor)
 * agree on this shape via a single shared declaration.
 */
export interface LookupJobData {
  /** UUID of the corresponding `lookups` row, written before enqueue. */
  readonly lookupId: string
  /** OsintProvider.id — looked up in the worker's registry. */
  readonly providerId: string
  /** Provider-validated query payload (already passed inputSchema.parse). */
  readonly query: unknown
}
