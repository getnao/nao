CREATE TABLE "cloud_billing_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"free_seat_limit" integer DEFAULT 3 NOT NULL,
	"team_min_seats" integer DEFAULT 4 NOT NULL,
	"team_max_seats" integer DEFAULT 40 NOT NULL,
	"credit_top_up_min_cents" integer DEFAULT 2000 NOT NULL,
	"credit_top_up_max_cents" integer DEFAULT 50000 NOT NULL,
	"platform_fee_basis_points" integer DEFAULT 500 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_billing_policy_valid" CHECK (trial_days > 0 AND free_seat_limit >= 0 AND team_min_seats > 0 AND team_min_seats <= team_max_seats AND credit_top_up_min_cents > 0 AND credit_top_up_min_cents <= credit_top_up_max_cents AND platform_fee_basis_points BETWEEN 0 AND 10000)
);
--> statement-breakpoint
INSERT INTO "cloud_billing_policy" ("id") VALUES ('default');
