CREATE TABLE `project_provider_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`limit_usd` integer NOT NULL,
	`period` text NOT NULL CHECK(period IN ('day', 'week', 'month')),
	`current_period_start` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`notified_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_provider_budget_projectId_idx` ON `project_provider_budget` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_provider_budget_project_provider` ON `project_provider_budget` (`project_id`,`provider`);