ALTER TABLE "project_llm_config" DROP CONSTRAINT "project_llm_config_project_provider";--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "llm_config_id" text;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "llm_config_id" text;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "llm_config_id" text;--> statement-breakpoint
ALTER TABLE "context_recommendation_run" ADD COLUMN "llm_config_id" text;--> statement-breakpoint
ALTER TABLE "llm_inference" ADD COLUMN "llm_config_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "llm_access_mode" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_llm_config" ADD COLUMN "name" text;--> statement-breakpoint
UPDATE "project_llm_config" SET "name" = "provider";--> statement-breakpoint
ALTER TABLE "project_llm_config" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_llm_config" ADD COLUMN "credential_source" text DEFAULT 'database' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_llm_config" ADD COLUMN "disabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "llm_config_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "llm_model_ids_by_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_llm_config" ADD CONSTRAINT "project_llm_config_project_name" UNIQUE("project_id","name");