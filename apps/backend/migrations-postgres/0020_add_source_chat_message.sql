ALTER TABLE "account" DROP CONSTRAINT "story_version_chat_story_version_unique";--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "source" text;