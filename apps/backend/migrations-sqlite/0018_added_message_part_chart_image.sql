CREATE TABLE `chart_image` (
	`id` text PRIMARY KEY NOT NULL,
	`tool_call_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chart_image_tool_call_id_unique` ON `chart_image` (`tool_call_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_part_tool_call_id_unique` ON `message_part` (`tool_call_id`);