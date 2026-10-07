CREATE TABLE "organization_billing" (
	"org_id" text PRIMARY KEY NOT NULL,
	"billing_plan" text,
	"billing_status" text,
	"trial_started_at" timestamp,
	"trial_ends_at" timestamp,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"current_period_starts_at" timestamp,
	"current_period_ends_at" timestamp,
	"cancellation_scheduled" boolean,
	"has_default_payment_method" boolean,
	"billing_access_ends_at" timestamp,
	"billing_updated_at" timestamp,
	"billing_sync_token" text,
	CONSTRAINT "organization_billing_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "organization_billing_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"stripe_object_id" text,
	"livemode" boolean NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "organization_billing" ADD CONSTRAINT "organization_billing_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
