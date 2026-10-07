ALTER TABLE "chat_message" ADD COLUMN "discord_message_id" text;--> statement-breakpoint
CREATE INDEX "chat_message_discordMessageId_idx" ON "chat_message" USING btree ("discord_message_id");