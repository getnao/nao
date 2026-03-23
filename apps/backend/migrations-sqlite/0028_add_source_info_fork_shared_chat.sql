ALTER TABLE `chat` ADD `source_info` text;--> statement-breakpoint
CREATE INDEX `chat_sourceInfo_idx` ON `chat` (`source_info`);