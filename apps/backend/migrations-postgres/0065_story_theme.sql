CREATE TABLE "project_story_theme" (
	"project_id" text PRIMARY KEY NOT NULL,
	"theme" jsonb,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_story_theme" ADD CONSTRAINT "project_story_theme_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;