CREATE TABLE `shared_chat` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`visibility` text DEFAULT 'project' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_chat_chatId_unique` ON `shared_chat` (`chat_id`);--> statement-breakpoint
CREATE TABLE `shared_chat_access` (
	`shared_chat_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`shared_chat_id`, `user_id`),
	FOREIGN KEY (`shared_chat_id`) REFERENCES `shared_chat`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
