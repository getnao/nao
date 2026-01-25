DROP INDEX IF EXISTS "project_llm_config_unique";--> statement-breakpoint
ALTER TABLE "project_llm_config" ADD COLUMN "enabled_models" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_llm_config" ADD COLUMN "base_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "project_llm_config_project_provider" ON "project_llm_config" ("project_id","provider");