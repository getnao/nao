CREATE TABLE `user_skill` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`share_status` text DEFAULT 'private' NOT NULL,
	`share_note` text,
	`share_requested_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_skill_project_user_name_unique` ON `user_skill` (`project_id`,`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `user_skill_project_share_status_idx` ON `user_skill` (`project_id`,`share_status`);