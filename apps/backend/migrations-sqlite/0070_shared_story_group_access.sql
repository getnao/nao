CREATE TABLE `shared_story_group_access` (
	`shared_story_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`shared_story_id`, `group_id`),
	FOREIGN KEY (`shared_story_id`) REFERENCES `shared_story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shared_story_group_access_groupId_idx` ON `shared_story_group_access` (`group_id`);