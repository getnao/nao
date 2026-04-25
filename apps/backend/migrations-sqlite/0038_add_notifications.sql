CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`payload` text,
	`read` integer DEFAULT false NOT NULL,
	`action_url` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_userId_idx` ON `notification` (`user_id`);--> statement-breakpoint
CREATE INDEX `notification_userId_read_idx` ON `notification` (`user_id`,`read`);--> statement-breakpoint
CREATE INDEX `notification_createdAt_idx` ON `notification` (`created_at`);--> statement-breakpoint
CREATE TABLE `notification_preference` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event` text NOT NULL,
	`channel` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_pref_userId_idx` ON `notification_preference` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_pref_user_event_channel` ON `notification_preference` (`user_id`,`event`,`channel`);