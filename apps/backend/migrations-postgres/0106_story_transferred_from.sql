ALTER TABLE "story" ADD COLUMN "transferred_from_chat_id" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "transferred_from_slug" text;--> statement-breakpoint
CREATE INDEX "story_transferredFrom_idx" ON "story" USING btree ("transferred_from_chat_id","transferred_from_slug");