CREATE TABLE `story_folder` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_folder_userId_idx` ON `story_folder` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_folder_userId_name_unique` ON `story_folder` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `story_organization` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`story_id` text NOT NULL,
	`is_starred` integer DEFAULT false NOT NULL,
	`folder_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `story_folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `story_org_userId_idx` ON `story_organization` (`user_id`);--> statement-breakpoint
CREATE INDEX `story_org_folderId_idx` ON `story_organization` (`folder_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_org_userId_chatId_storyId_unique` ON `story_organization` (`user_id`,`chat_id`,`story_id`);