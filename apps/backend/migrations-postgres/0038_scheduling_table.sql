CREATE TABLE "scheduled_job" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb,
	"run_at" timestamp NOT NULL,
	"cron" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"locked_at" timestamp,
	"locked_by" text,
	"unique_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_job_unique_key_unique" UNIQUE("unique_key")
);
--> statement-breakpoint
CREATE INDEX "scheduled_job_status_runAt_idx" ON "scheduled_job" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "scheduled_job_name_idx" ON "scheduled_job" USING btree ("name");