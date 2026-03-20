CREATE TABLE `story_data_cache` (
	`chat_id` text NOT NULL,
	`story_id` text NOT NULL,
	`query_data` text NOT NULL,
	`regenerated_code` text,
	`cached_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`chat_id`, `story_id`),
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `story_version` ADD `is_live` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `story_version` ADD `cache_schedule` text;--> statement-breakpoint
ALTER TABLE `story_version` ADD `refresh_text` integer DEFAULT false NOT NULL;