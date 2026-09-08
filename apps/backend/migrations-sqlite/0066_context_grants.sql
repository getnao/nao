ALTER TABLE `user_group` ADD `context_grants` text;--> statement-breakpoint
ALTER TABLE `story_data_cache` ADD `query_sources` text;--> statement-breakpoint
UPDATE `user_group`
SET `context_grants` = CASE
	WHEN `is_default` = 1 THEN '{"version":1,"access":{"mode":"all"}}'
	ELSE '{"version":1,"access":{"mode":"restricted","grants":[]}}'
END;