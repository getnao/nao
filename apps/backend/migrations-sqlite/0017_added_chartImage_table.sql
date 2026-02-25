CREATE TABLE `chart_image` (
	`tool_call_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
