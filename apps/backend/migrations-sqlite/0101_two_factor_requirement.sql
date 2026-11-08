ALTER TABLE `org_member` ADD `two_factor_grace_restarted_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `two_factor_required_at` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `two_factor_grace_period_days` integer DEFAULT 7 NOT NULL;