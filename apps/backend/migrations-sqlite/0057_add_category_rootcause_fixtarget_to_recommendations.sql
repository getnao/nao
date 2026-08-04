ALTER TABLE `context_recommendation` ADD `fix_target` text;--> statement-breakpoint
ALTER TABLE `context_recommendation` ADD `category` text;--> statement-breakpoint
ALTER TABLE `context_recommendation` ADD `root_cause` text;--> statement-breakpoint
ALTER TABLE `context_recommendation` ADD `root_cause_kind` text;--> statement-breakpoint
ALTER TABLE `context_recommendation` DROP COLUMN `severity`;