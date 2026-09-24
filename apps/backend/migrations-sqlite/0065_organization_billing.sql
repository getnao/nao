ALTER TABLE `organization` ADD `billing_plan` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `billing_status` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `trial_started_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `trial_ends_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `stripe_price_id` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `current_period_ends_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `cancel_at_period_end` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `has_default_payment_method` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `billing_access_ends_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `billing_updated_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `billing_sync_token` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `trial_reminder_claimed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_stripe_customer_id_unique` ON `organization` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_stripe_subscription_id_unique` ON `organization` (`stripe_subscription_id`);--> statement-breakpoint
CREATE TABLE `stripe_webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`stripe_object_id` text,
	`livemode` integer NOT NULL,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`processed_at` integer,
	`last_error` text
);