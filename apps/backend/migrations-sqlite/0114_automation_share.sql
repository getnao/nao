CREATE TABLE `automation_share` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`user_id` text,
	`group_id` text,
	`role` text DEFAULT 'viewer' NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_share_automationId_idx` ON `automation_share` (`automation_id`);--> statement-breakpoint
CREATE INDEX `automation_share_userId_idx` ON `automation_share` (`user_id`);--> statement-breakpoint
CREATE INDEX `automation_share_groupId_idx` ON `automation_share` (`group_id`);