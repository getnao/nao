CREATE TABLE `context_branch_ownership` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`branch` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `context_branch_ownership_userId_idx` ON `context_branch_ownership` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `context_branch_ownership_project_branch_unique` ON `context_branch_ownership` (`project_id`,`branch`);