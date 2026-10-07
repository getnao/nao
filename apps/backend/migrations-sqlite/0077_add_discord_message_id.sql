ALTER TABLE `chat_message` ADD `discord_message_id` text;--> statement-breakpoint
CREATE INDEX `chat_message_discordMessageId_idx` ON `chat_message` (`discord_message_id`);