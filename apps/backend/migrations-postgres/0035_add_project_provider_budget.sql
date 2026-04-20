CREATE TABLE "project_provider_budget" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"limit_usd" integer NOT NULL,
	"period" text NOT NULL,
	CONSTRAINT "budget_period_valid" CHECK ("project_provider_budget"."period" IN ('day', 'week', 'month')),
	"current_period_start" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"notified_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_provider_budget_project_provider" UNIQUE("project_id","provider")
);
--> statement-breakpoint
ALTER TABLE "project_provider_budget" ADD CONSTRAINT "project_provider_budget_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_provider_budget_projectId_idx" ON "project_provider_budget" USING btree ("project_id");