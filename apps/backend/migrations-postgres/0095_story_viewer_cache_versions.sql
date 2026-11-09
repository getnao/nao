ALTER TABLE "story_viewer_data_cache" ADD COLUMN "story_version_id" text;--> statement-breakpoint
UPDATE "story_viewer_data_cache" AS "cache"
SET "story_version_id" = (
	SELECT "version"."id"
	FROM "story_version" AS "version"
	WHERE "version"."story_id" = "cache"."story_id"
	ORDER BY "version"."version" DESC
	LIMIT 1
);--> statement-breakpoint
ALTER TABLE "story_viewer_data_cache" ALTER COLUMN "story_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "story_viewer_data_cache" DROP CONSTRAINT "story_viewer_data_cache_story_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "story_viewer_data_cache" ADD CONSTRAINT "story_viewer_data_cache_story_version_id_user_id_pk" PRIMARY KEY("story_version_id","user_id");--> statement-breakpoint
ALTER TABLE "story_viewer_data_cache" ADD CONSTRAINT "story_viewer_data_cache_story_version_id_story_version_id_fk" FOREIGN KEY ("story_version_id") REFERENCES "public"."story_version"("id") ON DELETE cascade ON UPDATE no action;