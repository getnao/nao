PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_story_viewer_data_cache` (
	`story_id` text NOT NULL,
	`story_version_id` text NOT NULL,
	`user_id` text NOT NULL,
	`query_data` text NOT NULL,
	`query_sources` text,
	`analysis_results` text,
	`cached_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`story_version_id`, `user_id`),
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_version_id`) REFERENCES `story_version`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_story_viewer_data_cache`("story_id", "story_version_id", "user_id", "query_data", "query_sources", "analysis_results", "cached_at")
SELECT
	`cache`.`story_id`,
	(
		SELECT `version`.`id`
		FROM `story_version` AS `version`
		WHERE `version`.`story_id` = `cache`.`story_id`
		ORDER BY `version`.`version` DESC
		LIMIT 1
	),
	`cache`.`user_id`,
	`cache`.`query_data`,
	`cache`.`query_sources`,
	`cache`.`analysis_results`,
	`cache`.`cached_at`
FROM `story_viewer_data_cache` AS `cache`;--> statement-breakpoint
DROP TABLE `story_viewer_data_cache`;--> statement-breakpoint
ALTER TABLE `__new_story_viewer_data_cache` RENAME TO `story_viewer_data_cache`;--> statement-breakpoint
PRAGMA foreign_keys=ON;