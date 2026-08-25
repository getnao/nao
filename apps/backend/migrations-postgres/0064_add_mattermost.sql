ALTER TABLE "chat" ADD COLUMN "mattermost_thread_id" text;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "mattermost_post_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "mattermost_settings" jsonb;--> statement-breakpoint
CREATE INDEX "chat_mattermost_thread_idx" ON "chat" USING btree ("mattermost_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_mattermostPostId_idx" ON "chat_message" USING btree ("mattermost_post_id");