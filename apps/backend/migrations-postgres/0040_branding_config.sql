CREATE TABLE "branding_config" (
	"id" text PRIMARY KEY NOT NULL,
	"app_name" text,
	"tab_title" text,
	"sidebar_logo_data" text,
	"sidebar_logo_media_type" text,
	"auth_logo_data" text,
	"auth_logo_media_type" text,
	"favicon_data" text,
	"favicon_media_type" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
