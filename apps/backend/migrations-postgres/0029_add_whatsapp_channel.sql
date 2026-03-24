ALTER TABLE "chat" ADD COLUMN "whatsapp_thread_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "whatsapp_settings" jsonb;--> statement-breakpoint
CREATE INDEX "chat_whatsapp_thread_idx" ON "chat" USING btree ("whatsapp_thread_id");