CREATE TABLE "message_image" (
	"id" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"media_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT "local_project_path_required";--> statement-breakpoint
ALTER TABLE "story" ALTER COLUMN "is_live_text_dynamic" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "media_type" text;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "image_id" text;--> statement-breakpoint
ALTER TABLE "message_part" ADD CONSTRAINT "message_part_image_id_message_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."message_image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_part" ADD CONSTRAINT "file_fields_required" CHECK (CASE WHEN "message_part"."type" = 'file' THEN "message_part"."media_type" IS NOT NULL AND "message_part"."image_id" IS NOT NULL ELSE TRUE END);--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "local_project_path_required" CHECK (CASE WHEN "type" = 'local' THEN "path" IS NOT NULL ELSE TRUE END);