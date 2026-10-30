CREATE TABLE "organization_seat_state" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"selected_at" timestamp,
	"is_read_only" boolean DEFAULT false NOT NULL,
	"state_changed_at" timestamp,
	"owner_in_app_notified_at" timestamp,
	"owner_email_notified_at" timestamp,
	"admin_email_notified_at" timestamp,
	CONSTRAINT "organization_seat_state_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "stripe_subscription_item_id" text;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "seat_quantity" integer;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "stripe_subscription_schedule_id" text;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "pending_billing_plan" text;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD COLUMN "pending_seat_quantity" integer;--> statement-breakpoint
ALTER TABLE "organization_seat_state" ADD CONSTRAINT "organization_seat_state_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_seat_state" ADD CONSTRAINT "organization_seat_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_seat_state_userId_idx" ON "organization_seat_state" USING btree ("user_id");