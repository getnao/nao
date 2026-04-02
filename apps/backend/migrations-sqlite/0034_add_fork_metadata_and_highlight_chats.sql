ALTER TABLE `chat` ADD `fork_metadata` text;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `isForked` integer;