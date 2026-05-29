CREATE TABLE `story_favorite` (
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `story_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_favorite_userId_idx` ON `story_favorite` (`user_id`);--> statement-breakpoint
CREATE INDEX `story_favorite_storyId_idx` ON `story_favorite` (`story_id`);--> statement-breakpoint
CREATE TABLE `story_folder` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`favorited_at` integer,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_folder_userId_projectId_parentId_idx` ON `story_folder` (`user_id`,`project_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `story_folder_projectId_idx` ON `story_folder` (`project_id`);--> statement-breakpoint
CREATE TABLE `story_folder_item` (
	`user_id` text NOT NULL,
	`story_id` text NOT NULL,
	`folder_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `story_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `story_folder`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_folder_item_folderId_idx` ON `story_folder_item` (`folder_id`);--> statement-breakpoint
ALTER TABLE `shared_story` ADD `is_pinned` integer DEFAULT false NOT NULL;