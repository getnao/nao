CREATE TABLE `shared_story` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`story_id` text NOT NULL,
	`visibility` text DEFAULT 'project' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shared_story_projectId_idx` ON `shared_story` (`project_id`);--> statement-breakpoint
CREATE INDEX `shared_story_chat_story_idx` ON `shared_story` (`chat_id`,`story_id`);--> statement-breakpoint
CREATE TABLE `shared_story_access` (
	`shared_story_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`shared_story_id`, `user_id`),
	FOREIGN KEY (`shared_story_id`) REFERENCES `shared_story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `story_version` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`story_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`code` text NOT NULL,
	`action` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `story_version_chat_story_version_unique` UNIQUE(`chat_id`,`story_id`,`version`),
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_version_chat_story_idx` ON `story_version` (`chat_id`,`story_id`);