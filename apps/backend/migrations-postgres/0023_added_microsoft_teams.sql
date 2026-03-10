ALTER TABLE "chat" ADD COLUMN "teams_thread_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "slack_settings" jsonb;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "teams_settings" jsonb;--> statement-breakpoint
CREATE INDEX "chat_teams_thread_idx" ON "chat" USING btree ("teams_thread_id");--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "slack_bot_token";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "slack_signing_secret";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "slack_llm_provider";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "slack_llm_model_id";