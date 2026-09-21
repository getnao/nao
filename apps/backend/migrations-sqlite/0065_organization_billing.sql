ALTER TABLE `organization` ADD `billing_plan` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `billing_status` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `trial_started_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `trial_ends_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `stripe_price_id` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `current_period_ends_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `cancel_at_period_end` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `billing_access_ends_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `billing_updated_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_stripe_customer_id_unique` ON `organization` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_stripe_subscription_id_unique` ON `organization` (`stripe_subscription_id`);