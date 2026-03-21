ALTER TABLE "project" ADD COLUMN "git_url" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "git_branch" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "git_token" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "git_project_url_required" CHECK (CASE WHEN "project"."type" = 'git' THEN "project"."git_url" IS NOT NULL ELSE TRUE END);