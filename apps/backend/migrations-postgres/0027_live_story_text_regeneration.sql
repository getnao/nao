ALTER TABLE "story_version" ADD COLUMN "refresh_text" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "story_data_cache" ADD COLUMN "regenerated_code" text;
