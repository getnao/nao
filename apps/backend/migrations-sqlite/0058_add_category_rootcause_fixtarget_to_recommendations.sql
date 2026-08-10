CREATE TABLE `context_recommendation_linked_feedback` (
	`recommendation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`recommendation_id`, `message_id`),
	FOREIGN KEY (`recommendation_id`) REFERENCES `context_recommendation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `chat_message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `context_recommendation` ADD `fix_target` text;--> statement-breakpoint
ALTER TABLE `context_recommendation` ADD `category` text;--> statement-breakpoint
ALTER TABLE `context_recommendation` ADD `root_cause` text;--> statement-breakpoint
ALTER TABLE `context_recommendation` ADD `root_cause_kind` text;--> statement-breakpoint
ALTER TABLE `context_recommendation` DROP COLUMN `snoozed_until`;--> statement-breakpoint
ALTER TABLE `context_recommendation` DROP COLUMN `severity`;--> statement-breakpoint
CREATE INDEX `context_recommendation_linked_feedback_message_id_idx` ON `context_recommendation_linked_feedback` (`message_id`);--> statement-breakpoint
UPDATE `context_recommendation` SET `status` = 'dismissed' WHERE `status` IN ('acknowledged', 'snoozed');