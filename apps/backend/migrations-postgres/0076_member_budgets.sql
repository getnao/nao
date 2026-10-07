CREATE TABLE "member_budget_notification" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_budget_notification_project_user_period" UNIQUE("project_id","user_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "project_group_budget" (
	"group_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"limit_usd" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_member_budget" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"limit_usd" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_budget_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_member_budget_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"default_limit_usd" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_budget_period_valid" CHECK ("project_member_budget_settings"."period" IN ('week', 'month', 'year'))
);
--> statement-breakpoint
ALTER TABLE "member_budget_notification" ADD CONSTRAINT "member_budget_notification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_budget_notification" ADD CONSTRAINT "member_budget_notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_budget" ADD CONSTRAINT "project_group_budget_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group_budget" ADD CONSTRAINT "project_group_budget_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member_budget" ADD CONSTRAINT "project_member_budget_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member_budget" ADD CONSTRAINT "project_member_budget_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member_budget_settings" ADD CONSTRAINT "project_member_budget_settings_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_group_budget_projectId_idx" ON "project_group_budget" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_member_budget_userId_idx" ON "project_member_budget" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_message_chatId_createdAt_idx" ON "chat_message" USING btree ("chat_id","created_at");