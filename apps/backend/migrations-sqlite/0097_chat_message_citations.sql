ALTER TABLE `chat_message` ADD `citations` text;--> statement-breakpoint
UPDATE `chat_message` SET `citations` = json_array(json(`citation`)) WHERE `citation` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_message` DROP COLUMN `citation`;