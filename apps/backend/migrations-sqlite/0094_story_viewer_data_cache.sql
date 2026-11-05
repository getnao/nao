CREATE TABLE `story_viewer_data_cache` (
	`story_id` text NOT NULL,
	`user_id` text NOT NULL,
	`query_data` text NOT NULL,
	`query_sources` text,
	`analysis_results` text,
	`cached_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`story_id`, `user_id`),
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
