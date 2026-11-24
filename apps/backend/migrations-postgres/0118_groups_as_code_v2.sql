ALTER TABLE "project" ADD COLUMN "user_groups_config_applied_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "config_id" text;--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "member_emails" jsonb;--> statement-breakpoint
ALTER TABLE "user_group" ADD CONSTRAINT "user_group_project_config_id_unique" UNIQUE("project_id","config_id");