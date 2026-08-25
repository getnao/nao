ALTER TABLE `chat` ADD `mattermost_thread_id` text;--> statement-breakpoint
CREATE INDEX `chat_mattermost_thread_idx` ON `chat` (`mattermost_thread_id`);--> statement-breakpoint
ALTER TABLE `chat_message` ADD `mattermost_post_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_message_mattermostPostId_idx` ON `chat_message` (`mattermost_post_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `mattermost_settings` text;