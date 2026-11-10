CREATE TABLE `story_viewer_data_cache` (
	`story_id` text NOT NULL,
	`story_version_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission_revision` text NOT NULL,
	`query_data` text NOT NULL,
	`code` text,
	`query_sources` text,
	`analysis_results` text,
	`cached_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`story_version_id`, `user_id`),
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_version_id`) REFERENCES `story_version`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_viewer_data_cache_story_id_idx` ON `story_viewer_data_cache` (`story_id`);--> statement-breakpoint
CREATE INDEX `story_viewer_data_cache_user_id_idx` ON `story_viewer_data_cache` (`user_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `viewer_cache_revision` integer DEFAULT 0 NOT NULL;