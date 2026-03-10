ALTER TABLE `chat` ADD `teams_thread_id` text;--> statement-breakpoint
CREATE INDEX `chat_teams_thread_idx` ON `chat` (`teams_thread_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `slack_settings` text;--> statement-breakpoint
ALTER TABLE `project` ADD `teams_settings` text;--> statement-breakpoint
ALTER TABLE `project` DROP COLUMN `slack_bot_token`;--> statement-breakpoint
ALTER TABLE `project` DROP COLUMN `slack_signing_secret`;--> statement-breakpoint
ALTER TABLE `project` DROP COLUMN `slack_llm_provider`;--> statement-breakpoint
ALTER TABLE `project` DROP COLUMN `slack_llm_model_id`;