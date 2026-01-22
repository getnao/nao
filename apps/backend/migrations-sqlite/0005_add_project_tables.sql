CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`path` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "local_project_path_required" CHECK(CASE WHEN "project"."type" = 'local' THEN "project"."path" IS NOT NULL ELSE TRUE END)
);
--> statement-breakpoint
CREATE TABLE `project_llm_config` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`api_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_llm_config_projectId_idx` ON `project_llm_config` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_member` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_member_userId_idx` ON `project_member` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_slack_config` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`bot_token` text NOT NULL,
	`signing_secret` text NOT NULL,
	`post_message_url` text DEFAULT 'https://slack.com/api/chat.postMessage' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_slack_config_project_id_unique` ON `project_slack_config` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_slack_config_projectId_idx` ON `project_slack_config` (`project_id`);--> statement-breakpoint
DELETE FROM `chat` WHERE `project_id` IS NULL;--> statement-breakpoint
ALTER TABLE `chat` ADD `project_id` text NOT NULL REFERENCES project(id);--> statement-breakpoint
CREATE INDEX `chat_projectId_idx` ON `chat` (`project_id`);