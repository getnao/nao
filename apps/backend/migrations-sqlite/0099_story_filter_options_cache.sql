CREATE TABLE `story_filter_options_cache` (
	`story_id` text NOT NULL,
	`cache_key` text NOT NULL,
	`options` text NOT NULL,
	`is_complete` integer NOT NULL,
	`cached_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`story_id`, `cache_key`),
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade
);
