ALTER TABLE "organization" ADD COLUMN "billing_plan" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billing_status" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "trial_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "trial_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "stripe_price_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "current_period_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "cancel_at_period_end" boolean;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billing_access_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billing_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");--> statement-breakpoint
CREATE TABLE "stripe_webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"stripe_object_id" text,
	"livemode" boolean NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"last_error" text
);