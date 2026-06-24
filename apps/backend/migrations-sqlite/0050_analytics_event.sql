CREATE TABLE `analytics_event` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`asset_type` text NOT NULL,
	`actor_user_id` text,
	`chat_id` text,
	`story_id` text,
	`shared_chat_id` text,
	`shared_story_id` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_chat_id`) REFERENCES `shared_chat`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`shared_story_id`) REFERENCES `shared_story`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "analytics_event_asset_id_required" CHECK(CASE WHEN asset_type = 'chat' THEN chat_id IS NOT NULL WHEN asset_type = 'story' THEN story_id IS NOT NULL ELSE TRUE END)
);
--> statement-breakpoint
CREATE INDEX `analytics_event_projectId_idx` ON `analytics_event` (`project_id`);--> statement-breakpoint
CREATE INDEX `analytics_event_chatId_idx` ON `analytics_event` (`chat_id`);--> statement-breakpoint
CREATE INDEX `analytics_event_storyId_idx` ON `analytics_event` (`story_id`);--> statement-breakpoint
CREATE INDEX `analytics_event_sharedChatId_idx` ON `analytics_event` (`shared_chat_id`);--> statement-breakpoint
CREATE INDEX `analytics_event_sharedStoryId_idx` ON `analytics_event` (`shared_story_id`);--> statement-breakpoint
CREATE INDEX `analytics_event_actorUserId_idx` ON `analytics_event` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `analytics_event_type_createdAt_idx` ON `analytics_event` (`type`,`created_at`);