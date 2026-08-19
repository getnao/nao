CREATE TABLE `budget_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`scope` text NOT NULL,
	`period_start` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `budget_notification_projectId_idx` ON `budget_notification` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_notification_project_provider_scope_period` ON `budget_notification` (`project_id`,`provider`,`scope`,`period_start`);--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link_url` text,
	`payload` text,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_userId_idx` ON `notification` (`user_id`);--> statement-breakpoint
CREATE INDEX `notification_user_read_idx` ON `notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notification_user_project_read_idx` ON `notification` (`user_id`,`project_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notification_createdAt_idx` ON `notification` (`created_at`);--> statement-breakpoint
CREATE TABLE `notification_unsubscribe` (
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `scope`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_unsubscribe_userId_idx` ON `notification_unsubscribe` (`user_id`);--> statement-breakpoint
CREATE TABLE `story_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`project_id` text,
	`enabled` integer DEFAULT false NOT NULL,
	`cron` text,
	`schedule_description` text,
	`channels` text NOT NULL,
	`recipient_mode` text DEFAULT 'specific' NOT NULL,
	`recipient_user_ids` text NOT NULL,
	`scheduled_job_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `story`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scheduled_job_id`) REFERENCES `scheduled_job`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_delivery_story_id_unique` ON `story_delivery` (`story_id`);--> statement-breakpoint
CREATE INDEX `story_delivery_storyId_idx` ON `story_delivery` (`story_id`);--> statement-breakpoint
ALTER TABLE `automation_run` ADD `read_at` integer;--> statement-breakpoint
INSERT OR IGNORE INTO `notification` (`id`, `user_id`, `project_id`, `category`, `title`, `body`, `link_url`, `payload`, `read_at`, `created_at`)
SELECT
	'activity-' || a.`id` || '-' || pm.`user_id`,
	pm.`user_id`,
	a.`project_id`,
	'shared',
	u.`name` || ' shared a story with you',
	'"' || st.`title` || '"',
	'/stories/shared/' || ss.`id`,
	json_object('kind', 'shared', 'sharerName', u.`name`, 'itemLabel', 'story', 'itemTitle', st.`title`, 'visibility', ss.`visibility`),
	a.`started_at`,
	a.`started_at`
FROM `activity` a
JOIN `shared_story` ss ON ss.`id` = a.`shared_story_id`
JOIN `story` st ON st.`id` = a.`story_id`
JOIN `user` u ON u.`id` = a.`user_id`
JOIN `project_member` pm ON pm.`project_id` = a.`project_id` AND pm.`user_id` <> a.`user_id`
WHERE a.`type` = 'story.shared'
	AND ss.`visibility` = 'project'
	AND a.`started_at` >= (unixepoch('now') * 1000 - 7776000000);--> statement-breakpoint
INSERT OR IGNORE INTO `notification` (`id`, `user_id`, `project_id`, `category`, `title`, `body`, `link_url`, `payload`, `read_at`, `created_at`)
SELECT
	'activity-' || a.`id` || '-' || ssa.`user_id`,
	ssa.`user_id`,
	a.`project_id`,
	'shared',
	u.`name` || ' shared a story with you',
	'"' || st.`title` || '"',
	'/stories/shared/' || ss.`id`,
	json_object('kind', 'shared', 'sharerName', u.`name`, 'itemLabel', 'story', 'itemTitle', st.`title`, 'visibility', ss.`visibility`),
	a.`started_at`,
	a.`started_at`
FROM `activity` a
JOIN `shared_story` ss ON ss.`id` = a.`shared_story_id`
JOIN `shared_story_access` ssa ON ssa.`shared_story_id` = ss.`id` AND ssa.`user_id` <> a.`user_id`
JOIN `story` st ON st.`id` = a.`story_id`
JOIN `user` u ON u.`id` = a.`user_id`
WHERE a.`type` = 'story.shared'
	AND ss.`visibility` = 'specific'
	AND a.`started_at` >= (unixepoch('now') * 1000 - 7776000000);--> statement-breakpoint
INSERT OR IGNORE INTO `notification` (`id`, `user_id`, `project_id`, `category`, `title`, `body`, `link_url`, `payload`, `read_at`, `created_at`)
SELECT
	'activity-' || a.`id` || '-' || pm.`user_id`,
	pm.`user_id`,
	a.`project_id`,
	'shared',
	u.`name` || ' shared a chat with you',
	'"' || ch.`title` || '"',
	'/shared-chat/' || sc.`id`,
	json_object('kind', 'shared', 'sharerName', u.`name`, 'itemLabel', 'chat', 'itemTitle', ch.`title`, 'visibility', sc.`visibility`),
	a.`started_at`,
	a.`started_at`
FROM `activity` a
JOIN `shared_chat` sc ON sc.`id` = a.`shared_chat_id`
JOIN `chat` ch ON ch.`id` = a.`chat_id`
JOIN `user` u ON u.`id` = a.`user_id`
JOIN `project_member` pm ON pm.`project_id` = a.`project_id` AND pm.`user_id` <> a.`user_id`
WHERE a.`type` = 'chat.shared'
	AND sc.`visibility` = 'project'
	AND a.`started_at` >= (unixepoch('now') * 1000 - 7776000000);--> statement-breakpoint
INSERT OR IGNORE INTO `notification` (`id`, `user_id`, `project_id`, `category`, `title`, `body`, `link_url`, `payload`, `read_at`, `created_at`)
SELECT
	'activity-' || a.`id` || '-' || sca.`user_id`,
	sca.`user_id`,
	a.`project_id`,
	'shared',
	u.`name` || ' shared a chat with you',
	'"' || ch.`title` || '"',
	'/shared-chat/' || sc.`id`,
	json_object('kind', 'shared', 'sharerName', u.`name`, 'itemLabel', 'chat', 'itemTitle', ch.`title`, 'visibility', sc.`visibility`),
	a.`started_at`,
	a.`started_at`
FROM `activity` a
JOIN `shared_chat` sc ON sc.`id` = a.`shared_chat_id`
JOIN `shared_chat_access` sca ON sca.`shared_chat_id` = sc.`id` AND sca.`user_id` <> a.`user_id`
JOIN `chat` ch ON ch.`id` = a.`chat_id`
JOIN `user` u ON u.`id` = a.`user_id`
WHERE a.`type` = 'chat.shared'
	AND sc.`visibility` = 'specific'
	AND a.`started_at` >= (unixepoch('now') * 1000 - 7776000000);--> statement-breakpoint
INSERT OR IGNORE INTO `notification` (`id`, `user_id`, `project_id`, `category`, `title`, `body`, `link_url`, `payload`, `read_at`, `created_at`)
SELECT
	'activity-' || a.`id` || '-' || COALESCE(st.`user_id`, ch.`user_id`),
	COALESCE(st.`user_id`, ch.`user_id`),
	a.`project_id`,
	'story_refresh',
	st.`title`,
	'Re-ran ' || COALESCE(json_extract(a.`payload`, '$.queriesRefreshed'), 0) || ' ' || CASE WHEN COALESCE(json_extract(a.`payload`, '$.queriesRefreshed'), 0) = 1 THEN 'query' ELSE 'queries' END || ' against the latest data.',
	COALESCE('/stories/shared/' || ss.`id`, '/stories/standalone/' || st.`id`),
	json_object('kind', 'story_refresh', 'storyId', st.`id`, 'status', 'refreshed', 'queriesRefreshed', COALESCE(json_extract(a.`payload`, '$.queriesRefreshed'), 0), 'trigger', CASE WHEN a.`trigger` = 'manual' THEN 'manual' ELSE 'schedule' END),
	a.`started_at`,
	a.`started_at`
FROM `activity` a
JOIN `story` st ON st.`id` = a.`story_id`
LEFT JOIN `chat` ch ON ch.`id` = st.`chat_id`
LEFT JOIN `shared_story` ss ON ss.`story_id` = st.`id` AND ss.`project_id` = a.`project_id`
WHERE a.`type` = 'story.refreshed'
	AND a.`status` = 'completed'
	AND COALESCE(st.`user_id`, ch.`user_id`) IS NOT NULL
	AND a.`started_at` >= (unixepoch('now') * 1000 - 7776000000);--> statement-breakpoint
INSERT OR IGNORE INTO `notification` (`id`, `user_id`, `project_id`, `category`, `title`, `body`, `link_url`, `payload`, `read_at`, `created_at`)
SELECT
	'activity-' || a.`id` || '-' || pm.`user_id`,
	pm.`user_id`,
	a.`project_id`,
	'story_refresh',
	st.`title`,
	'Re-ran ' || COALESCE(json_extract(a.`payload`, '$.queriesRefreshed'), 0) || ' ' || CASE WHEN COALESCE(json_extract(a.`payload`, '$.queriesRefreshed'), 0) = 1 THEN 'query' ELSE 'queries' END || ' against the latest data.',
	'/stories/shared/' || ss.`id`,
	json_object('kind', 'story_refresh', 'storyId', st.`id`, 'status', 'refreshed', 'queriesRefreshed', COALESCE(json_extract(a.`payload`, '$.queriesRefreshed'), 0), 'trigger', CASE WHEN a.`trigger` = 'manual' THEN 'manual' ELSE 'schedule' END),
	a.`started_at`,
	a.`started_at`
FROM `activity` a
JOIN `story` st ON st.`id` = a.`story_id`
JOIN `shared_story` ss ON ss.`story_id` = st.`id` AND ss.`project_id` = a.`project_id` AND ss.`visibility` = 'project'
JOIN `project_member` pm ON pm.`project_id` = a.`project_id`
WHERE a.`type` = 'story.refreshed'
	AND a.`status` = 'completed'
	AND a.`started_at` >= (unixepoch('now') * 1000 - 7776000000);--> statement-breakpoint
INSERT OR IGNORE INTO `notification` (`id`, `user_id`, `project_id`, `category`, `title`, `body`, `link_url`, `payload`, `read_at`, `created_at`)
SELECT
	'activity-' || a.`id` || '-' || ssa.`user_id`,
	ssa.`user_id`,
	a.`project_id`,
	'story_refresh',
	st.`title`,
	'Re-ran ' || COALESCE(json_extract(a.`payload`, '$.queriesRefreshed'), 0) || ' ' || CASE WHEN COALESCE(json_extract(a.`payload`, '$.queriesRefreshed'), 0) = 1 THEN 'query' ELSE 'queries' END || ' against the latest data.',
	'/stories/shared/' || ss.`id`,
	json_object('kind', 'story_refresh', 'storyId', st.`id`, 'status', 'refreshed', 'queriesRefreshed', COALESCE(json_extract(a.`payload`, '$.queriesRefreshed'), 0), 'trigger', CASE WHEN a.`trigger` = 'manual' THEN 'manual' ELSE 'schedule' END),
	a.`started_at`,
	a.`started_at`
FROM `activity` a
JOIN `story` st ON st.`id` = a.`story_id`
JOIN `shared_story` ss ON ss.`story_id` = st.`id` AND ss.`project_id` = a.`project_id` AND ss.`visibility` = 'specific'
JOIN `shared_story_access` ssa ON ssa.`shared_story_id` = ss.`id`
WHERE a.`type` = 'story.refreshed'
	AND a.`status` = 'completed'
	AND a.`started_at` >= (unixepoch('now') * 1000 - 7776000000);