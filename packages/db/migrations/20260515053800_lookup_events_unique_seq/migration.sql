DROP INDEX "lookup_events_lookup_seq_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "lookup_events_lookup_seq_unq" ON "lookup_events" ("lookup_id","seq");
