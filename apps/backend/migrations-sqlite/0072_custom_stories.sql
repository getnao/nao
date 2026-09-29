CREATE TABLE `project_story_theme` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`theme` text,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_story_theme_projectId_idx` ON `project_story_theme` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_story_theme_project_version_unique` ON `project_story_theme` (`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `story_bundle` (
	`story_version_id` text PRIMARY KEY NOT NULL,
	`bundle` text,
	`bundle_error` text,
	`built_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_version_id`) REFERENCES `story_version`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `story_draft_file` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`path` text NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_draft_file_storyId_idx` ON `story_draft_file` (`story_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_draft_file_story_path_unique` ON `story_draft_file` (`story_id`,`path`);--> statement-breakpoint
CREATE TABLE `story_file` (
	`id` text PRIMARY KEY NOT NULL,
	`story_version_id` text NOT NULL,
	`path` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_version_id`) REFERENCES `story_version`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_hash`) REFERENCES `story_file_blob`(`content_hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `story_file_storyVersionId_idx` ON `story_file` (`story_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_file_version_path_unique` ON `story_file` (`story_version_id`,`path`);--> statement-breakpoint
CREATE TABLE `story_file_blob` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `story` ADD `format` text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
UPDATE `user_group` SET `feature_grants` = json_insert(`feature_grants`, '$.features[#]', 'customStoryCreation')
WHERE `is_default` = 1
	AND json_type(`feature_grants`, '$.features') = 'array'
	AND EXISTS (SELECT 1 FROM json_each(`feature_grants`, '$.features') WHERE `value` = 'storyCreation')
	AND NOT EXISTS (SELECT 1 FROM json_each(`feature_grants`, '$.features') WHERE `value` = 'customStoryCreation');--> statement-breakpoint
UPDATE `user_group` SET `feature_grants` = json_insert(`feature_grants`, '$[#]', 'customStoryCreation')
WHERE `is_default` = 1
	AND json_type(`feature_grants`) = 'array'
	AND EXISTS (SELECT 1 FROM json_each(`feature_grants`) WHERE `value` IN ('storyCreation', 'stories', 'story-creation'))
	AND NOT EXISTS (SELECT 1 FROM json_each(`feature_grants`) WHERE `value` = 'customStoryCreation');
