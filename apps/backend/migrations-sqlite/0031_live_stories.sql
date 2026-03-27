PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `story` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`is_live` integer DEFAULT false NOT NULL,
	`is_live_text_dynamic` integer DEFAULT false NOT NULL,
	`cache_schedule` text,
	`cache_schedule_description` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_chatId_idx` ON `story` (`chat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_chat_slug_unique` ON `story` (`chat_id`,`slug`);--> statement-breakpoint
CREATE TABLE `story_data_cache` (
	`story_id` text PRIMARY KEY NOT NULL,
	`query_data` text NOT NULL,
	`analysis_results` text,
	`cached_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `story` (`id`, `chat_id`, `slug`, `title`, `archived_at`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
	sv.`chat_id`,
	sv.`story_id`,
	sv.`title`,
	sv.`archived_at`,
	min(sv.`created_at`),
	max(sv.`created_at`)
FROM `story_version` sv
GROUP BY sv.`chat_id`, sv.`story_id`;--> statement-breakpoint
UPDATE `story_version` SET `story_id` = (
	SELECT st.`id` FROM `story` st
	WHERE st.`chat_id` = `story_version`.`chat_id` AND st.`slug` = `story_version`.`story_id`
);--> statement-breakpoint
UPDATE `shared_story` SET `story_id` = (
	SELECT st.`id` FROM `story` st
	WHERE st.`chat_id` = `shared_story`.`chat_id` AND st.`slug` = `shared_story`.`story_id`
);--> statement-breakpoint
CREATE TABLE `__new_shared_story` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`visibility` text DEFAULT 'project' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_shared_story`("id", "story_id", "project_id", "user_id", "visibility", "created_at") SELECT "id", "story_id", "project_id", "user_id", "visibility", "created_at" FROM `shared_story`;--> statement-breakpoint
DROP TABLE `shared_story`;--> statement-breakpoint
ALTER TABLE `__new_shared_story` RENAME TO `shared_story`;--> statement-breakpoint
CREATE INDEX `shared_story_projectId_idx` ON `shared_story` (`project_id`);--> statement-breakpoint
CREATE INDEX `shared_story_storyId_idx` ON `shared_story` (`story_id`);--> statement-breakpoint
CREATE TABLE `__new_story_version` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`version` integer NOT NULL,
	`code` text NOT NULL,
	`action` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_story_version`("id", "story_id", "version", "code", "action", "source", "created_at") SELECT "id", "story_id", "version", "code", "action", "source", "created_at" FROM `story_version`;--> statement-breakpoint
DROP TABLE `story_version`;--> statement-breakpoint
ALTER TABLE `__new_story_version` RENAME TO `story_version`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `story_version_storyId_idx` ON `story_version` (`story_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_version_story_version_unique` ON `story_version` (`story_id`,`version`);