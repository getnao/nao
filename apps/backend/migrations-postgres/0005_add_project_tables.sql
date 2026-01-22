CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"path" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "local_project_path_required" CHECK (CASE WHEN "project"."type" = 'local' THEN "project"."path" IS NOT NULL ELSE TRUE END)
);
--> statement-breakpoint
CREATE TABLE "project_llm_config" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"api_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_member" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_slack_config" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"bot_token" text NOT NULL,
	"signing_secret" text NOT NULL,
	"post_message_url" text DEFAULT 'https://slack.com/api/chat.postMessage' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_slack_config_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "project_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "project_llm_config" ADD CONSTRAINT "project_llm_config_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_config" ADD CONSTRAINT "project_slack_config_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_llm_config_projectId_idx" ON "project_llm_config" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_member_userId_idx" ON "project_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_slack_config_projectId_idx" ON "project_slack_config" USING btree ("project_id");--> statement-breakpoint
TRUNCATE TABLE "chat";--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_projectId_idx" ON "chat" USING btree ("project_id");