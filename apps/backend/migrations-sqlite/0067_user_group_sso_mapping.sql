CREATE TABLE `user_group_sso_member` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`, `provider`),
	FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_group_sso_member_user_provider_idx` ON `user_group_sso_member` (`user_id`,`provider`);--> statement-breakpoint
ALTER TABLE `user_group` ADD `sso_mappings` text;