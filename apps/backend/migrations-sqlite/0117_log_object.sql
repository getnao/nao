ALTER TABLE `log` ADD `object_type` text;--> statement-breakpoint
ALTER TABLE `log` ADD `object_id` text;--> statement-breakpoint
CREATE INDEX `log_object_idx` ON `log` (`object_type`,`object_id`,`created_at`);