ALTER TABLE `chat` ADD `teams_thread_id` text;--> statement-breakpoint
CREATE INDEX `chat_teams_thread_idx` ON `chat` (`teams_thread_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `slack_settings` text;--> statement-breakpoint
ALTER TABLE `project` ADD `teams_settings` text;--> statement-breakpoint
UPDATE `project` SET `slack_settings` = json_object(
  'slackBotToken',      COALESCE(`slack_bot_token`, ''),
  'slackSigningSecret', COALESCE(`slack_signing_secret`, ''),
  'slackllmProvider',   COALESCE(`slack_llm_provider`, ''),
  'slackllmModelId',    COALESCE(`slack_llm_model_id`, '')
) WHERE `slack_bot_token` IS NOT NULL OR `slack_signing_secret` IS NOT NULL OR `slack_llm_provider` IS NOT NULL OR `slack_llm_model_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `project` DROP COLUMN `slack_bot_token`;--> statement-breakpoint
ALTER TABLE `project` DROP COLUMN `slack_signing_secret`;--> statement-breakpoint
ALTER TABLE `project` DROP COLUMN `slack_llm_provider`;--> statement-breakpoint
ALTER TABLE `project` DROP COLUMN `slack_llm_model_id`;