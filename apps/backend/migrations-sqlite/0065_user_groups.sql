CREATE TABLE `user_group` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`feature_grants` text DEFAULT '{"version":2,"features":[],"toolCallDensity":{"defaultDensity":"detailed","canChange":true}}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_group_projectId_idx` ON `user_group` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_group_project_default_unique` ON `user_group` (`project_id`) WHERE "user_group"."is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `user_group_project_name_unique` ON `user_group` (`project_id`,`name`);--> statement-breakpoint
INSERT INTO `user_group` (`id`, `project_id`, `name`, `is_default`, `feature_grants`)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`id`,
	'All Users',
	1,
	'{"version":2,"features":["story-creation","automation-creation"],"toolCallDensity":{"defaultDensity":"detailed","canChange":true}}'
FROM `project`;--> statement-breakpoint
CREATE TABLE `user_group_member` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_group_member_userId_idx` ON `user_group_member` (`user_id`);