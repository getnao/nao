ALTER TABLE "org_member" ADD COLUMN "two_factor_grace_restarted_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "two_factor_required_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "two_factor_grace_period_days" integer DEFAULT 7 NOT NULL;