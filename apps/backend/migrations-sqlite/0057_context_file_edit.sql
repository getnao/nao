CREATE TABLE `context_file_edit` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`user_id` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `context_file_edit_projectId_idx` ON `context_file_edit` (`project_id`);--> statement-breakpoint
CREATE INDEX `context_file_edit_userId_idx` ON `context_file_edit` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `context_file_edit_project_path_unique` ON `context_file_edit` (`project_id`,`path`);