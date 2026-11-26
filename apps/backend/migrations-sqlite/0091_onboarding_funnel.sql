CREATE TABLE `warehouse_connection_check` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`outcome` text NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `warehouse_connection_check_userId_idx` ON `warehouse_connection_check` (`user_id`);--> statement-breakpoint
ALTER TABLE `warehouse_provisioning_job` ADD `failed_status` text;