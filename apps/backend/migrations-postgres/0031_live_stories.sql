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
INSERT INTO "story" ("id", "chat_id", "slug", "title", "archived_at", "created_at", "updated_at")
SELECT
	gen_random_uuid()::text,
	sv."chat_id",
	sv."story_id",
	(array_agg(sv."title" ORDER BY sv."version" DESC))[1],
	(array_agg(sv."archived_at" ORDER BY sv."version" DESC))[1],
	min(sv."created_at"),
	max(sv."created_at")
FROM "story_version" sv
GROUP BY sv."chat_id", sv."story_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "story_version" SET "story_id" = st."id"
FROM "story" st
WHERE "story_version"."chat_id" = st."chat_id" AND "story_version"."story_id" = st."slug";--> statement-breakpoint
UPDATE "shared_story" SET "story_id" = st."id"
FROM "story" st
WHERE "shared_story"."chat_id" = st."chat_id" AND "shared_story"."story_id" = st."slug";--> statement-breakpoint
DELETE FROM "shared_story" WHERE "story_id" NOT IN (SELECT "id" FROM "story");--> statement-breakpoint
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