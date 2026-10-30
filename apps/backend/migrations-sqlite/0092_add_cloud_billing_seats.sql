CREATE TABLE `organization_seat_state` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`selected_at` integer,
	`is_read_only` integer DEFAULT false NOT NULL,
	`state_changed_at` integer,
	`owner_in_app_notified_at` integer,
	`owner_email_notified_at` integer,
	`admin_email_notified_at` integer,
	PRIMARY KEY(`org_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `organization_seat_state_userId_idx` ON `organization_seat_state` (`user_id`);--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `stripe_subscription_item_id` text;--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `seat_quantity` integer;--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `stripe_subscription_schedule_id` text;--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `pending_billing_plan` text;--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `pending_seat_quantity` integer;