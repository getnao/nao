ALTER TABLE `chat` ADD `whatsapp_thread_id` text;--> statement-breakpoint
CREATE INDEX `chat_whatsapp_thread_idx` ON `chat` (`whatsapp_thread_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `whatsapp_settings` text;