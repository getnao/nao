ALTER TABLE "project" ADD COLUMN "row_security" jsonb;--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "row_policies" jsonb;