ALTER TABLE "chat_message" ADD COLUMN "version_group_id" text;--> statement-breakpoint
CREATE INDEX "chat_message_versionGroupId_idx" ON "chat_message" USING btree ("version_group_id");