CREATE TABLE `story_app_state` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`scope` text NOT NULL,
	`user_id` text,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "story_app_state_user_scope" CHECK((scope = 'user') = (user_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `story_app_state_storyId_idx` ON `story_app_state` (`story_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_app_state_project_key_unique` ON `story_app_state` (`story_id`,`key`) WHERE scope = 'project';--> statement-breakpoint
CREATE UNIQUE INDEX `story_app_state_user_key_unique` ON `story_app_state` (`story_id`,`user_id`,`key`) WHERE scope = 'user';