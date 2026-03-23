ALTER TABLE "chat" ADD COLUMN "telegram_thread_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "telegram_settings" jsonb;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "messaging_provider_code" text;--> statement-breakpoint
CREATE INDEX "chat_telegram_thread_idx" ON "chat" USING btree ("telegram_thread_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_messaging_provider_code_unique" UNIQUE("messaging_provider_code");