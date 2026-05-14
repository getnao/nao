CREATE TABLE "branding_config" (
	"id" text PRIMARY KEY NOT NULL,
	"app_name" text,
	"tab_title" text,
	"logo_data" text,
	"logo_media_type" text,
	"favicon_data" text,
	"favicon_media_type" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
