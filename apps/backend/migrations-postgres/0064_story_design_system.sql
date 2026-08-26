ALTER TABLE "branding_config" ADD COLUMN "story_theme_draft" text;--> statement-breakpoint
ALTER TABLE "branding_config" ADD COLUMN "story_theme" text;--> statement-breakpoint
ALTER TABLE "branding_config" ADD COLUMN "story_theme_source" text;--> statement-breakpoint
ALTER TABLE "branding_config" ADD COLUMN "story_theme_source_kind" text;--> statement-breakpoint
ALTER TABLE "branding_config" ADD COLUMN "story_theme_notes" text;--> statement-breakpoint
ALTER TABLE "branding_config" ADD COLUMN "story_theme_enabled" boolean DEFAULT false NOT NULL;