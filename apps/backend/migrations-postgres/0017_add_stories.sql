CREATE TABLE "shared_story" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"code" text NOT NULL,
	"query_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_version" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"story_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"code" text NOT NULL,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_story" ADD CONSTRAINT "shared_story_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_story" ADD CONSTRAINT "shared_story_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_version" ADD CONSTRAINT "story_version_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_story_projectId_idx" ON "shared_story" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "story_version_chat_story_idx" ON "story_version" USING btree ("chat_id","story_id");