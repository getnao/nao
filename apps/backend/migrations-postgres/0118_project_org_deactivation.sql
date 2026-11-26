ALTER TABLE "organization" ADD COLUMN "deactivated_at" timestamp;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "deactivated_at" timestamp;