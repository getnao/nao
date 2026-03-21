PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`path` text,
	`git_url` text,
	`git_branch` text,
	`git_token` text,
	`agent_settings` text,
	`enabled_tools` text DEFAULT '[]' NOT NULL,
	`known_mcp_servers` text DEFAULT '[]' NOT NULL,
	`slack_settings` text,
	`teams_settings` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "local_project_path_required" CHECK(CASE WHEN "__new_project"."type" = 'local' THEN "__new_project"."path" IS NOT NULL ELSE TRUE END),
	CONSTRAINT "git_project_url_required" CHECK(CASE WHEN "__new_project"."type" = 'git' THEN "__new_project"."git_url" IS NOT NULL ELSE TRUE END)
);
--> statement-breakpoint
INSERT INTO `__new_project`("id", "org_id", "name", "type", "path", "git_url", "git_branch", "git_token", "agent_settings", "enabled_tools", "known_mcp_servers", "slack_settings", "teams_settings", "created_at", "updated_at") SELECT "id", "org_id", "name", "type", "path", "git_url", "git_branch", "git_token", "agent_settings", "enabled_tools", "known_mcp_servers", "slack_settings", "teams_settings", "created_at", "updated_at" FROM `project`;--> statement-breakpoint
DROP TABLE `project`;--> statement-breakpoint
ALTER TABLE `__new_project` RENAME TO `project`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `project_orgId_idx` ON `project` (`org_id`);