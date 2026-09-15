CREATE TABLE `project_story_theme` (
	`project_id` text PRIMARY KEY NOT NULL,
	`theme` text,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
