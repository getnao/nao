CREATE TABLE `log` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`context` text,
	`source` text NOT NULL,
	`project_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `log_createdAt_idx` ON `log` (`created_at`);--> statement-breakpoint
CREATE INDEX `log_level_idx` ON `log` (`level`);--> statement-breakpoint
CREATE INDEX `log_projectId_idx` ON `log` (`project_id`);