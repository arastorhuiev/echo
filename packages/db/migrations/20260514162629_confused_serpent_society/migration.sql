CREATE TYPE "lookup_status" AS ENUM('queued', 'running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "breaker_state" AS ENUM('closed', 'half_open', 'open');--> statement-breakpoint
CREATE TABLE "lookup_events" (
	"id" bigserial PRIMARY KEY,
	"lookup_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider_id" text NOT NULL,
	"query_hash" text NOT NULL,
	"query" jsonb NOT NULL,
	"status" "lookup_status" DEFAULT 'queued'::"lookup_status" NOT NULL,
	"result" jsonb,
	"error_kind" text,
	"error_message" text,
	"ip_address" text,
	"user_id" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid,
	"provider" text NOT NULL,
	"external_id" text,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY,
	"enabled" boolean DEFAULT true NOT NULL,
	"breaker_state" "breaker_state" DEFAULT 'closed'::"breaker_state" NOT NULL,
	"breaker_opened_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lookup_events_lookup_seq_idx" ON "lookup_events" ("lookup_id","seq");--> statement-breakpoint
CREATE INDEX "lookups_provider_query_hash_idx" ON "lookups" ("provider_id","query_hash");--> statement-breakpoint
CREATE INDEX "lookups_created_at_idx" ON "lookups" ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lookups_status_idx" ON "lookups" ("status");--> statement-breakpoint
ALTER TABLE "lookup_events" ADD CONSTRAINT "lookup_events_lookup_id_lookups_id_fkey" FOREIGN KEY ("lookup_id") REFERENCES "lookups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "lookups" ADD CONSTRAINT "lookups_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;