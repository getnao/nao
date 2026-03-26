CREATE TABLE "story" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"is_live_text_dynamic" boolean DEFAULT false NOT NULL,
	"cache_schedule" text,
	"cache_schedule_description" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_chat_slug_unique" UNIQUE("chat_id","slug")
);
--> statement-breakpoint
CREATE TABLE "story_data_cache" (
	"story_id" text PRIMARY KEY NOT NULL,
	"query_data" jsonb NOT NULL,
	"analysis_results" jsonb,
	"cached_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_version" DROP CONSTRAINT "story_version_chat_story_version_unique";--> statement-breakpoint
ALTER TABLE "shared_story" DROP CONSTRAINT "shared_story_chat_id_chat_id_fk";
--> statement-breakpoint
ALTER TABLE "story_version" DROP CONSTRAINT "story_version_chat_id_chat_id_fk";
--> statement-breakpoint
DROP INDEX "shared_story_chat_story_idx";--> statement-breakpoint
DROP INDEX "story_version_chat_story_idx";--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_data_cache" ADD CONSTRAINT "story_data_cache_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_chatId_idx" ON "story" USING btree ("chat_id");--> statement-breakpoint
ALTER TABLE "shared_story" ADD CONSTRAINT "shared_story_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_version" ADD CONSTRAINT "story_version_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_story_storyId_idx" ON "shared_story" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_version_storyId_idx" ON "story_version" USING btree ("story_id");--> statement-breakpoint
ALTER TABLE "shared_story" DROP COLUMN "chat_id";--> statement-breakpoint
ALTER TABLE "story_version" DROP COLUMN "chat_id";--> statement-breakpoint
ALTER TABLE "story_version" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "story_version" DROP COLUMN "archived_at";--> statement-breakpoint
ALTER TABLE "story_version" ADD CONSTRAINT "story_version_story_version_unique" UNIQUE("story_id","version");