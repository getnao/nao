ALTER TABLE "chat" ADD COLUMN "fork_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "isForked" boolean;