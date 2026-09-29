ALTER TABLE "chat_message" ADD COLUMN "sender_user_id" text;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_message_senderUserId_idx" ON "chat_message" USING btree ("sender_user_id");