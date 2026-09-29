CREATE TABLE "project_story_theme" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"theme" jsonb,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_story_theme_project_version_unique" UNIQUE("project_id","version")
);
--> statement-breakpoint
CREATE TABLE "story_bundle" (
	"story_version_id" text PRIMARY KEY NOT NULL,
	"bundle" text,
	"bundle_error" text,
	"built_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_draft_file" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_draft_file_story_path_unique" UNIQUE("story_id","path")
);
--> statement-breakpoint
CREATE TABLE "story_file" (
	"id" text PRIMARY KEY NOT NULL,
	"story_version_id" text NOT NULL,
	"path" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_file_version_path_unique" UNIQUE("story_version_id","path")
);
--> statement-breakpoint
CREATE TABLE "story_file_blob" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "format" text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_story_theme" ADD CONSTRAINT "project_story_theme_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bundle" ADD CONSTRAINT "story_bundle_story_version_id_story_version_id_fk" FOREIGN KEY ("story_version_id") REFERENCES "public"."story_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_draft_file" ADD CONSTRAINT "story_draft_file_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_file" ADD CONSTRAINT "story_file_story_version_id_story_version_id_fk" FOREIGN KEY ("story_version_id") REFERENCES "public"."story_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_file" ADD CONSTRAINT "story_file_content_hash_story_file_blob_content_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."story_file_blob"("content_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_story_theme_projectId_idx" ON "project_story_theme" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "story_draft_file_storyId_idx" ON "story_draft_file" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_file_storyVersionId_idx" ON "story_file" USING btree ("story_version_id");--> statement-breakpoint
UPDATE "user_group" SET "feature_grants" = jsonb_set("feature_grants", '{features}', ("feature_grants"->'features') || '["customStoryCreation"]'::jsonb)
WHERE "is_default" = true
	AND jsonb_typeof("feature_grants"->'features') = 'array'
	AND ("feature_grants"->'features') ? 'storyCreation'
	AND NOT (("feature_grants"->'features') ? 'customStoryCreation');--> statement-breakpoint
UPDATE "user_group" SET "feature_grants" = "feature_grants" || '["customStoryCreation"]'::jsonb
WHERE "is_default" = true
	AND jsonb_typeof("feature_grants") = 'array'
	AND "feature_grants" ?| array['storyCreation', 'stories', 'story-creation']
	AND NOT ("feature_grants" ? 'customStoryCreation');
