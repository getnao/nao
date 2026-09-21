CREATE TABLE `mcp_map_embed` (
	`map_embed_id` text PRIMARY KEY NOT NULL,
	`query_id` text NOT NULL,
	`map_config` text NOT NULL,
	`source_chat_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`query_id`) REFERENCES `mcp_query_data`(`query_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_map_embed_query_id_idx` ON `mcp_map_embed` (`query_id`);--> statement-breakpoint
ALTER TABLE `project` ADD `map_settings` text;--> statement-breakpoint
UPDATE `project` SET `agent_settings` = json_set(`agent_settings`, '$.mapEnabled', json('true')) WHERE `agent_settings` IS NOT NULL AND json_type(`agent_settings`, '$.experimental.displayMap') = 'true' AND json_extract(`agent_settings`, '$.mapEnabled') IS NULL;--> statement-breakpoint
UPDATE `project` SET `agent_settings` = json_remove(`agent_settings`, '$.experimental.displayMap') WHERE `agent_settings` IS NOT NULL AND json_extract(`agent_settings`, '$.experimental.displayMap') IS NOT NULL;