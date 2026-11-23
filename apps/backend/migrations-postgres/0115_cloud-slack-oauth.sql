CREATE TABLE "project_slack_installation" (
	"project_id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"enterprise_id" text,
	"bot_user_id" text NOT NULL,
	"encrypted_bot_token" text NOT NULL,
	"scopes" text NOT NULL,
	"installed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_slack_installation" ADD CONSTRAINT "project_slack_installation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_installation" ADD CONSTRAINT "project_slack_installation_installed_by_user_id_user_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_slack_installation_teamId_idx" ON "project_slack_installation" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "project_slack_installation_installedByUserId_idx" ON "project_slack_installation" USING btree ("installed_by_user_id");