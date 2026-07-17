CREATE TYPE "search_kind" AS ENUM('email', 'username', 'phone', 'image', 'domain');--> statement-breakpoint
CREATE TYPE "search_status" AS ENUM('queued', 'running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"identifier" text NOT NULL,
	"kind" "search_kind" NOT NULL,
	"status" "search_status" DEFAULT 'queued'::"search_status" NOT NULL,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lookups" ADD COLUMN "search_id" uuid;--> statement-breakpoint
CREATE INDEX "lookups_search_id_idx" ON "lookups" ("search_id");--> statement-breakpoint
CREATE INDEX "searches_created_at_idx" ON "searches" ("created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "lookups" ADD CONSTRAINT "lookups_search_id_searches_id_fkey" FOREIGN KEY ("search_id") REFERENCES "searches"("id") ON DELETE CASCADE;