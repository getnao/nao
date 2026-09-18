CREATE TABLE "project_story_theme" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"theme" jsonb,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_story_theme" ADD CONSTRAINT "project_story_theme_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_story_theme_projectId_idx" ON "project_story_theme" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "project_story_theme" ADD CONSTRAINT "project_story_theme_project_version_unique" UNIQUE("project_id","version");
