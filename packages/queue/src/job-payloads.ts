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

/**
 * BullMQ job payload for the `q.search` orchestration queue (P12). The api
 * has already written the `searches` row + every child `lookups` row and
 * enqueued the children on their per-provider queues; the aggregator job
 * just watches the children's event streams and merges them.
 */
export interface SearchJobData {
  /** UUID of the `searches` row. */
  readonly searchId: string
  /** UUIDs of the child `lookups` rows to aggregate, each with its providerId. */
  readonly children: ReadonlyArray<{ readonly lookupId: string; readonly providerId: string }>
}
