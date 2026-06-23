ALTER TABLE `chat_message` ADD `version_group_id` text;--> statement-breakpoint
CREATE INDEX `chat_message_versionGroupId_idx` ON `chat_message` (`version_group_id`);