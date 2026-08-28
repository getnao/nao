ALTER TABLE "chat" ADD COLUMN "mattermost_thread_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "mattermost_settings" jsonb;--> statement-breakpoint
CREATE INDEX "chat_mattermost_thread_idx" ON "chat" USING btree ("mattermost_thread_id");