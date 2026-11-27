CREATE TABLE `story_folder_group` (
	`folder_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`folder_id`, `group_id`),
	FOREIGN KEY (`folder_id`) REFERENCES `story_folder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_folder_group_groupId_idx` ON `story_folder_group` (`group_id`);