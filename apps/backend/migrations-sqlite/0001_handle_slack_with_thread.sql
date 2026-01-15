ALTER TABLE `chat` ADD `slack_thread_id` text;--> statement-breakpoint
CREATE INDEX `chat_slack_thread_idx` ON `chat` (`slack_thread_id`);