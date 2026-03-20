ALTER TABLE `chat` ADD `telegram_thread_id` text;--> statement-breakpoint
CREATE INDEX `chat_telegram_thread_idx` ON `chat` (`telegram_thread_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `telegram_settings` text;--> statement-breakpoint
ALTER TABLE `user` ADD `messaging_provider_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_messaging_provider_code_unique` ON `user` (`messaging_provider_code`);