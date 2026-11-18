CREATE TABLE `shared_chat_group_access` (
	`shared_chat_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`shared_chat_id`, `group_id`),
	FOREIGN KEY (`shared_chat_id`) REFERENCES `shared_chat`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shared_chat_group_access_groupId_idx` ON `shared_chat_group_access` (`group_id`);--> statement-breakpoint
CREATE TABLE `story_edit_lock` (
	`story_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text,
	`session_id` text,
	`expires_at` integer NOT NULL,
	`acquired_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_edit_lock_userId_idx` ON `story_edit_lock` (`user_id`);--> statement-breakpoint
CREATE INDEX `story_edit_lock_chatId_idx` ON `story_edit_lock` (`chat_id`);--> statement-breakpoint
ALTER TABLE `shared_story` ADD `project_role` text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE `shared_story_access` ADD `role` text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE `shared_story_group_access` ADD `role` text DEFAULT 'viewer' NOT NULL;