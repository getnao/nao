CREATE TABLE `organization_billing` (
	`org_id` text PRIMARY KEY NOT NULL,
	`billing_plan` text,
	`billing_status` text,
	`trial_started_at` integer,
	`trial_ends_at` integer,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_price_id` text,
	`current_period_starts_at` integer,
	`current_period_ends_at` integer,
	`cancellation_scheduled` integer,
	`has_default_payment_method` integer,
	`billing_access_ends_at` integer,
	`billing_updated_at` integer,
	`billing_sync_token` text,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_stripe_customer_id_unique` ON `organization_billing` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_stripe_subscription_id_unique` ON `organization_billing` (`stripe_subscription_id`);--> statement-breakpoint
CREATE TABLE `stripe_webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`stripe_object_id` text,
	`livemode` integer NOT NULL,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`processed_at` integer,
	`last_error` text
);
