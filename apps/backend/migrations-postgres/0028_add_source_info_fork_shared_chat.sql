ALTER TABLE "chat" ADD COLUMN "source_info" jsonb;--> statement-breakpoint
CREATE INDEX "chat_sourceInfo_idx" ON "chat" USING btree ("source_info");