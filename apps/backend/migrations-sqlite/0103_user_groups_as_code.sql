CREATE TABLE `user_group_config_member` (
	`group_id` text NOT NULL,
	`normalized_email` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`group_id`, `normalized_email`)
);
--> statement-breakpoint
CREATE INDEX `user_group_config_member_email_active_idx` ON `user_group_config_member` (`normalized_email`,`active`);--> statement-breakpoint
ALTER TABLE `project` ADD `user_group_management_mode` text DEFAULT 'ui' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_group_budget` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `user_group` ADD `config_key` text;--> statement-breakpoint
ALTER TABLE `user_group` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `user_group` ADD `archived_name` text;--> statement-breakpoint
ALTER TABLE `user_group` ADD `sso_mappings_suspended_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `user_group_project_config_key_unique` ON `user_group` (`project_id`,`config_key`);--> statement-breakpoint
ALTER TABLE `user_group_member` ADD `active` integer DEFAULT true NOT NULL;