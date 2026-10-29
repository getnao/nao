ALTER TABLE "chat_message" ADD COLUMN "citations" jsonb;--> statement-breakpoint
UPDATE "chat_message" SET "citations" = jsonb_build_array("citation") WHERE "citation" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_message" DROP COLUMN "citation";