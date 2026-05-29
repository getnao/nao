CREATE TABLE `automation` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scheduled_job_id` text,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule_description` text,
	`timezone` text,
	`model_provider` text,
	`model_id` text,
	`mcp_enabled` integer DEFAULT true NOT NULL,
	`mcp_servers` text,
	`integrations` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scheduled_job_id`) REFERENCES `scheduled_job`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_projectId_idx` ON `automation` (`project_id`);--> statement-breakpoint
CREATE INDEX `automation_userId_idx` ON `automation` (`user_id`);--> statement-breakpoint
CREATE INDEX `automation_scheduledJobId_idx` ON `automation` (`scheduled_job_id`);--> statement-breakpoint
CREATE TABLE `automation_run` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`chat_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	`error_message` text,
	`integration_results` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_run_automationId_idx` ON `automation_run` (`automation_id`);--> statement-breakpoint
CREATE INDEX `automation_run_chatId_idx` ON `automation_run` (`chat_id`);--> statement-breakpoint
CREATE INDEX `automation_run_status_idx` ON `automation_run` (`status`);