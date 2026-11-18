ALTER TABLE `chat_message` ADD `sender_user_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `chat_message_senderUserId_idx` ON `chat_message` (`sender_user_id`);