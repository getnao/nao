CREATE TABLE `web_robot` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scheduled_job_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`definition` text NOT NULL,
	`definition_version` integer DEFAULT 1 NOT NULL,
	`definition_hash` text NOT NULL,
	`archived_at` integer,
	`last_successful_run_id` text,
	`last_successful_run_at` integer,
	`last_published_product_count` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scheduled_job_id`) REFERENCES `scheduled_job`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `web_robot_projectId_idx` ON `web_robot` (`project_id`);--> statement-breakpoint
CREATE INDEX `web_robot_userId_idx` ON `web_robot` (`user_id`);--> statement-breakpoint
CREATE INDEX `web_robot_scheduledJobId_idx` ON `web_robot` (`scheduled_job_id`);--> statement-breakpoint
CREATE INDEX `web_robot_archivedAt_idx` ON `web_robot` (`archived_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `web_robot_project_slug_unique` ON `web_robot` (`project_id`,`slug`);--> statement-breakpoint
CREATE TABLE `web_robot_run` (
	`id` text PRIMARY KEY NOT NULL,
	`robot_id` text NOT NULL,
	`scheduled_job_id` text,
	`triggered_by_user_id` text,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`definition` text NOT NULL,
	`definition_hash` text NOT NULL,
	`stats` text NOT NULL,
	`artifact_prefix` text,
	`error_message` text,
	`cancel_requested_at` integer,
	`queued_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`robot_id`) REFERENCES `web_robot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scheduled_job_id`) REFERENCES `scheduled_job`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `web_robot_run_robotId_idx` ON `web_robot_run` (`robot_id`);--> statement-breakpoint
CREATE INDEX `web_robot_run_robotId_queuedAt_idx` ON `web_robot_run` (`robot_id`,`queued_at`);--> statement-breakpoint
CREATE INDEX `web_robot_run_status_idx` ON `web_robot_run` (`status`);--> statement-breakpoint
CREATE INDEX `web_robot_run_scheduledJobId_idx` ON `web_robot_run` (`scheduled_job_id`);