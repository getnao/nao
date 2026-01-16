ALTER TABLE "chat" ADD COLUMN "slack_thread_id" text;--> statement-breakpoint
CREATE INDEX "chat_slack_thread_idx" ON "chat" USING btree ("slack_thread_id");