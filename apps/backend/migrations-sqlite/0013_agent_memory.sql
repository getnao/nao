CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`category` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`chat_id` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memories_chatId_idx` ON `memories` (`chat_id`);