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
CREATE UNIQUE INDEX `project_story_theme_project_version_unique` ON `project_story_theme` (`project_id`,`version`);
