CREATE TABLE "user_group_config_member" (
	"group_id" text NOT NULL,
	"normalized_email" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_group_config_member_group_id_normalized_email_pk" PRIMARY KEY("group_id","normalized_email")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "user_group_management_mode" text DEFAULT 'ui' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_group_budget" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "config_key" text;--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "archived_name" text;--> statement-breakpoint
ALTER TABLE "user_group" ADD COLUMN "sso_mappings_suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_group_member" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "user_group_config_member_email_active_idx" ON "user_group_config_member" USING btree ("normalized_email","active");--> statement-breakpoint
ALTER TABLE "user_group" ADD CONSTRAINT "user_group_project_config_key_unique" UNIQUE("project_id","config_key");