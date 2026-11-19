CREATE TABLE `story_query` (
	`story_id` text NOT NULL,
	`query_id` text NOT NULL,
	`sql_query` text NOT NULL,
	`database_id` text,
	`dialect` text,
	`admin_mode` integer DEFAULT false NOT NULL,
	`semantic_query` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`story_id`, `query_id`),
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade
);
