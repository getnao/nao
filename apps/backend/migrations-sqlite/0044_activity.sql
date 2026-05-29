CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`trigger` text DEFAULT 'system' NOT NULL,
	`story_id` text,
	`chat_id` text,
	`shared_story_id` text,
	`shared_chat_id` text,
	`payload` text,
	`error_message` text,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`shared_story_id`) REFERENCES `shared_story`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`shared_chat_id`) REFERENCES `shared_chat`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_projectId_idx` ON `activity` (`project_id`);--> statement-breakpoint
CREATE INDEX `activity_userId_idx` ON `activity` (`user_id`);--> statement-breakpoint
CREATE INDEX `activity_type_idx` ON `activity` (`type`);--> statement-breakpoint
CREATE INDEX `activity_storyId_idx` ON `activity` (`story_id`);--> statement-breakpoint
CREATE INDEX `activity_chatId_idx` ON `activity` (`chat_id`);--> statement-breakpoint
CREATE INDEX `activity_sharedStoryId_idx` ON `activity` (`shared_story_id`);--> statement-breakpoint
CREATE INDEX `activity_sharedChatId_idx` ON `activity` (`shared_chat_id`);--> statement-breakpoint
CREATE INDEX `activity_startedAt_idx` ON `activity` (`started_at`);--> statement-breakpoint
ALTER TABLE `story` ADD `scheduled_job_id` text REFERENCES scheduled_job(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `story_scheduledJobId_idx` ON `story` (`scheduled_job_id`);