ALTER TABLE `story_version` ADD `refresh_text` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `story_data_cache` ADD `regenerated_code` text;
