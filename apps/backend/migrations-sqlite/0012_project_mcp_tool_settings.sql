CREATE TABLE `project_mcp_tool_setting` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `server_name` text NOT NULL,
  `tool_name` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_mcp_tool_setting_project_server_tool_unique` ON `project_mcp_tool_setting` (`project_id`,`server_name`,`tool_name`);
--> statement-breakpoint
CREATE INDEX `project_mcp_tool_setting_projectId_idx` ON `project_mcp_tool_setting` (`project_id`);
