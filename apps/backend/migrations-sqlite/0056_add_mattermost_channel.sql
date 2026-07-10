ALTER TABLE `chat` ADD `mattermost_thread_id` text;--> statement-breakpoint
CREATE INDEX `chat_mattermost_thread_idx` ON `chat` (`mattermost_thread_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `mattermost_settings` text;
