CREATE TABLE `mcp_chart_embed` (
	`chart_embed_id` text PRIMARY KEY NOT NULL,
	`query_id` text NOT NULL,
	`chart_config` text NOT NULL,
	`source_chat_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`query_id`) REFERENCES `mcp_query_data`(`query_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_chart_embed_query_id_idx` ON `mcp_chart_embed` (`query_id`);--> statement-breakpoint
CREATE TABLE `mcp_query_data` (
	`query_id` text PRIMARY KEY NOT NULL,
	`call_log_id` text,
	`project_id` text NOT NULL,
	`source_chat_id` text,
	`columns` text NOT NULL,
	`data` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_query_data_project_id_idx` ON `mcp_query_data` (`project_id`);--> statement-breakpoint
CREATE INDEX `mcp_query_data_callLogId_idx` ON `mcp_query_data` (`call_log_id`);