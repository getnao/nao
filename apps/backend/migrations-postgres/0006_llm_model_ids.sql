ALTER TABLE "project_llm_config" DROP CONSTRAINT "project_llm_config_unique";--> statement-breakpoint
ALTER TABLE "project_llm_config" ADD COLUMN "enabled_models" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_llm_config" ADD COLUMN "base_url" text;--> statement-breakpoint
ALTER TABLE "project_llm_config" ADD CONSTRAINT "project_llm_config_project_provider" UNIQUE("project_id","provider");