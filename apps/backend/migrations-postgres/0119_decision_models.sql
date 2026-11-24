CREATE TABLE "project_decision_config" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"api_key" text,
	"credentials" jsonb,
	"base_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_decision_config_project_provider" UNIQUE("project_id","provider")
);
--> statement-breakpoint
ALTER TABLE "project_decision_config" ADD CONSTRAINT "project_decision_config_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;