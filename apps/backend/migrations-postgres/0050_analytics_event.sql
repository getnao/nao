CREATE TABLE "analytics_event" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"asset_type" text NOT NULL,
	"actor_user_id" text,
	"chat_id" text,
	"story_id" text,
	"shared_chat_id" text,
	"shared_story_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_event_asset_id_required" CHECK (CASE WHEN "analytics_event"."asset_type" = 'chat' THEN "analytics_event"."chat_id" IS NOT NULL WHEN "analytics_event"."asset_type" = 'story' THEN "analytics_event"."story_id" IS NOT NULL ELSE TRUE END)
);
--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_shared_chat_id_shared_chat_id_fk" FOREIGN KEY ("shared_chat_id") REFERENCES "public"."shared_chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_shared_story_id_shared_story_id_fk" FOREIGN KEY ("shared_story_id") REFERENCES "public"."shared_story"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_event_projectId_idx" ON "analytics_event" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "analytics_event_chatId_idx" ON "analytics_event" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "analytics_event_storyId_idx" ON "analytics_event" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "analytics_event_sharedChatId_idx" ON "analytics_event" USING btree ("shared_chat_id");--> statement-breakpoint
CREATE INDEX "analytics_event_sharedStoryId_idx" ON "analytics_event" USING btree ("shared_story_id");--> statement-breakpoint
CREATE INDEX "analytics_event_actorUserId_idx" ON "analytics_event" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "analytics_event_type_createdAt_idx" ON "analytics_event" USING btree ("type","created_at");