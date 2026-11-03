ALTER TABLE "chat" ADD COLUMN "google_chat_thread_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "google_chat_settings" jsonb;--> statement-breakpoint
CREATE INDEX "chat_google_chat_thread_idx" ON "chat" USING btree ("google_chat_thread_id");