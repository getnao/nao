CREATE TABLE `member_budget_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_budget_notification_project_user_period` ON `member_budget_notification` (`project_id`,`user_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `project_group_budget` (
	`group_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`limit_usd` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_group_budget_projectId_idx` ON `project_group_budget` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_member_budget` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`limit_usd` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_member_budget_userId_idx` ON `project_member_budget` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_member_budget_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`default_limit_usd` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_budget_period_valid" CHECK(period IN ('week', 'month', 'year'))
);
--> statement-breakpoint
CREATE INDEX `chat_message_chatId_createdAt_idx` ON `chat_message` (`chat_id`,`created_at`);