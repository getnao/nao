CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"trigger" text DEFAULT 'system' NOT NULL,
	"story_id" text,
	"chat_id" text,
	"shared_story_id" text,
	"shared_chat_id" text,
	"payload" jsonb,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "scheduled_job_id" text;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_shared_story_id_shared_story_id_fk" FOREIGN KEY ("shared_story_id") REFERENCES "public"."shared_story"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_shared_chat_id_shared_chat_id_fk" FOREIGN KEY ("shared_chat_id") REFERENCES "public"."shared_chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_projectId_idx" ON "activity" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "activity_userId_idx" ON "activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_type_idx" ON "activity" USING btree ("type");--> statement-breakpoint
CREATE INDEX "activity_storyId_idx" ON "activity" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "activity_chatId_idx" ON "activity" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "activity_sharedStoryId_idx" ON "activity" USING btree ("shared_story_id");--> statement-breakpoint
CREATE INDEX "activity_sharedChatId_idx" ON "activity" USING btree ("shared_chat_id");--> statement-breakpoint
CREATE INDEX "activity_startedAt_idx" ON "activity" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_scheduled_job_id_scheduled_job_id_fk" FOREIGN KEY ("scheduled_job_id") REFERENCES "public"."scheduled_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_scheduledJobId_idx" ON "story" USING btree ("scheduled_job_id");