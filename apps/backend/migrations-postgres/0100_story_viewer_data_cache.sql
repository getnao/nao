CREATE TABLE "story_viewer_data_cache" (
	"story_id" text NOT NULL,
	"story_version_id" text NOT NULL,
	"user_id" text NOT NULL,
	"query_data" jsonb NOT NULL,
	"code" text,
	"query_sources" jsonb,
	"analysis_results" jsonb,
	"cached_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_viewer_data_cache_story_version_id_user_id_pk" PRIMARY KEY("story_version_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "story_viewer_data_cache" ADD CONSTRAINT "story_viewer_data_cache_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_viewer_data_cache" ADD CONSTRAINT "story_viewer_data_cache_story_version_id_story_version_id_fk" FOREIGN KEY ("story_version_id") REFERENCES "public"."story_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_viewer_data_cache" ADD CONSTRAINT "story_viewer_data_cache_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;