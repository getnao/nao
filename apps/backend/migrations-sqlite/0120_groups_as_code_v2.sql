ALTER TABLE `project` ADD `user_groups_config_applied_at` integer;--> statement-breakpoint
ALTER TABLE `user_group` ADD `config_id` text;--> statement-breakpoint
ALTER TABLE `user_group` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `user_group` ADD `member_emails` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_group_project_config_id_unique` ON `user_group` (`project_id`,`config_id`);