ALTER TABLE `branding_config` ADD `story_theme_draft` text;--> statement-breakpoint
ALTER TABLE `branding_config` ADD `story_theme` text;--> statement-breakpoint
ALTER TABLE `branding_config` ADD `story_theme_source` text;--> statement-breakpoint
ALTER TABLE `branding_config` ADD `story_theme_source_kind` text;--> statement-breakpoint
ALTER TABLE `branding_config` ADD `story_theme_notes` text;--> statement-breakpoint
ALTER TABLE `branding_config` ADD `story_theme_enabled` integer DEFAULT false NOT NULL;