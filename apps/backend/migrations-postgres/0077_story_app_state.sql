CREATE TABLE "story_app_state" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"scope" text NOT NULL,
	"user_id" text,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_app_state_user_scope" CHECK ((scope = 'user') = (user_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "story_app_state" ADD CONSTRAINT "story_app_state_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_app_state" ADD CONSTRAINT "story_app_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_app_state" ADD CONSTRAINT "story_app_state_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_app_state_storyId_idx" ON "story_app_state" USING btree ("story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_app_state_project_key_unique" ON "story_app_state" USING btree ("story_id","key") WHERE scope = 'project';--> statement-breakpoint
CREATE UNIQUE INDEX "story_app_state_user_key_unique" ON "story_app_state" USING btree ("story_id","user_id","key") WHERE scope = 'user';