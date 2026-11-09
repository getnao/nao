DROP INDEX `project_llm_config_project_provider`;--> statement-breakpoint
ALTER TABLE `project_llm_config` ADD `name` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `project_llm_config` SET `name` = `provider`;--> statement-breakpoint
ALTER TABLE `project_llm_config` ADD `credential_source` text DEFAULT 'database' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_llm_config` ADD `disabled_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `project_llm_config_project_name` ON `project_llm_config` (`project_id`,`name`) WHERE "project_llm_config"."disabled_at" IS NULL;--> statement-breakpoint
ALTER TABLE `automation` ADD `llm_config_id` text;--> statement-breakpoint
ALTER TABLE `automation_run` ADD `llm_config_id` text;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `llm_config_id` text;--> statement-breakpoint
ALTER TABLE `context_recommendation_run` ADD `llm_config_id` text;--> statement-breakpoint
ALTER TABLE `llm_inference` ADD `llm_config_id` text;--> statement-breakpoint
ALTER TABLE `project` ADD `llm_access_mode` text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE `test_run_result` ADD `llm_config_id` text;--> statement-breakpoint
ALTER TABLE `user_group` ADD `llm_config_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_group` ADD `llm_model_ids_by_config` text DEFAULT '{}' NOT NULL;