CREATE TABLE `mcp_oauth_client` (
	`project_id` text NOT NULL,
	`server_name` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text,
	`client_data` text,
	`discovery_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`project_id`, `server_name`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discovery_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `mcp_user_token` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`server_name` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`expires_at` integer,
	`scope` text,
	`code_verifier` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`, `server_name`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_user_token_project_server_idx` ON `mcp_user_token` (`project_id`,`server_name`);--> statement-breakpoint
ALTER TABLE `project` ADD `disabled_mcp_servers` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `project` ADD `disabled_mcp_tools` text DEFAULT '[]' NOT NULL;