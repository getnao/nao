CREATE TABLE "group_budget_notification" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_budget_notification_group_user_period" UNIQUE("group_id","user_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "project_group_shared_budget" (
	"group_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"limit_usd" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_budget_notification" ADD CONSTRAINT "group_budget_notification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_budget_notification" ADD CONSTRAINT "group_budget_notification_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_budget_notification" ADD CONSTRAINT "group_budget_notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_shared_budget" ADD CONSTRAINT "project_group_shared_budget_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_shared_budget" ADD CONSTRAINT "project_group_shared_budget_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_group_shared_budget_projectId_idx" ON "project_group_shared_budget" USING btree ("project_id");