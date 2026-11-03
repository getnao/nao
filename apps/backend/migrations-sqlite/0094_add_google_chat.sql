ALTER TABLE `chat` ADD `google_chat_thread_id` text;--> statement-breakpoint
CREATE INDEX `chat_google_chat_thread_idx` ON `chat` (`google_chat_thread_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `google_chat_settings` text;