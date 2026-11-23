CREATE TABLE `project_slack_installation` (
	`project_id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`team_name` text NOT NULL,
	`enterprise_id` text,
	`bot_user_id` text NOT NULL,
	`encrypted_bot_token` text NOT NULL,
	`scopes` text NOT NULL,
	`installed_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_slack_installation_teamId_idx` ON `project_slack_installation` (`team_id`);--> statement-breakpoint
CREATE INDEX `project_slack_installation_installedByUserId_idx` ON `project_slack_installation` (`installed_by_user_id`);