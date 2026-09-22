ALTER TABLE "message_part" DROP CONSTRAINT "file_fields_required";--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "storage_path" text;--> statement-breakpoint
ALTER TABLE "message_part" ADD COLUMN "filename" text;--> statement-breakpoint
ALTER TABLE "message_part" ADD CONSTRAINT "file_fields_required" CHECK (CASE WHEN "message_part"."type" = 'file' THEN "message_part"."media_type" IS NOT NULL AND ("message_part"."image_id" IS NOT NULL OR "message_part"."storage_path" IS NOT NULL) ELSE TRUE END);