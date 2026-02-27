ALTER TABLE `chat_message` ADD `is_compaction_summary` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `message_part` ADD `summary_type` text;