CREATE TABLE `scheduled_job` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`payload` text,
	`run_at` integer NOT NULL,
	`cron` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`last_error` text,
	`locked_at` integer,
	`locked_by` text,
	`unique_key` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_job_unique_key_unique` ON `scheduled_job` (`unique_key`);--> statement-breakpoint
CREATE INDEX `scheduled_job_status_runAt_idx` ON `scheduled_job` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `scheduled_job_name_idx` ON `scheduled_job` (`name`);