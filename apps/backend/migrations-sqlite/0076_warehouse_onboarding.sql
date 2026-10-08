CREATE TABLE `project_warehouse_credentials` (
	`project_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `warehouse_provisioning_job` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`org_id` text NOT NULL,
	`onboarding_chat_id` text,
	`project_id` text,
	`project_name` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_credentials` text,
	`business_context` text,
	`model_selection` text,
	`model_project_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`temporary_directory` text,
	`locked_by` text,
	`locked_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `warehouse_provisioning_job_userId_idx` ON `warehouse_provisioning_job` (`user_id`);--> statement-breakpoint
CREATE INDEX `warehouse_provisioning_job_status_idx` ON `warehouse_provisioning_job` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `warehouse_provisioning_job_active_user_idx` ON `warehouse_provisioning_job` (`user_id`) WHERE "warehouse_provisioning_job"."status" NOT IN ('ready', 'failed', 'cancelled');