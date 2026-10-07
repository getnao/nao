CREATE TABLE `project_discord_link` (
	`project_id` text NOT NULL,
	`discord_user_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`project_id`, `discord_user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_discord_link_userId_idx` ON `project_discord_link` (`user_id`);--> statement-breakpoint
ALTER TABLE `chat` ADD `discord_thread_id` text;--> statement-breakpoint
CREATE INDEX `chat_discord_thread_idx` ON `chat` (`discord_thread_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `discord_settings` text;