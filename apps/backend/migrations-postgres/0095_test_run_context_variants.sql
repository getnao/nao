ALTER TABLE "test_run" ADD COLUMN "context_changes" jsonb;--> statement-breakpoint
ALTER TABLE "test_run_result" ADD COLUMN "context_variant" text DEFAULT 'production' NOT NULL;