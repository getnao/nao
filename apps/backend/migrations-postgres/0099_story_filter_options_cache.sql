CREATE TABLE "story_filter_options_cache" (
	"story_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"options" jsonb NOT NULL,
	"is_complete" boolean NOT NULL,
	"cached_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_filter_options_cache_story_id_cache_key_pk" PRIMARY KEY("story_id","cache_key")
);
--> statement-breakpoint
ALTER TABLE "story_filter_options_cache" ADD CONSTRAINT "story_filter_options_cache_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;