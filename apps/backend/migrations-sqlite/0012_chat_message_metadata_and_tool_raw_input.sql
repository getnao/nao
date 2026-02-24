ALTER TABLE `chat_message` ADD `input_total_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `input_no_cache_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `input_cache_read_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `input_cache_write_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `output_total_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `output_text_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `output_reasoning_tokens` integer;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `total_tokens` integer;--> statement-breakpoint
ALTER TABLE `message_part` ADD `tool_raw_input` text;--> statement-breakpoint
ALTER TABLE `message_part` ADD `tool_provider_metadata` text;--> statement-breakpoint
ALTER TABLE `message_part` ADD `provider_metadata` text;--> statement-breakpoint
UPDATE `chat_message` SET
  `input_total_tokens` = (SELECT MAX(`input_total_tokens`) FROM `message_part` WHERE `message_id` = `chat_message`.`id`),
  `input_no_cache_tokens` = (SELECT MAX(`input_no_cache_tokens`) FROM `message_part` WHERE `message_id` = `chat_message`.`id`),
  `input_cache_read_tokens` = (SELECT MAX(`input_cache_read_tokens`) FROM `message_part` WHERE `message_id` = `chat_message`.`id`),
  `input_cache_write_tokens` = (SELECT MAX(`input_cache_write_tokens`) FROM `message_part` WHERE `message_id` = `chat_message`.`id`),
  `output_total_tokens` = (SELECT MAX(`output_total_tokens`) FROM `message_part` WHERE `message_id` = `chat_message`.`id`),
  `output_text_tokens` = (SELECT MAX(`output_text_tokens`) FROM `message_part` WHERE `message_id` = `chat_message`.`id`),
  `output_reasoning_tokens` = (SELECT MAX(`output_reasoning_tokens`) FROM `message_part` WHERE `message_id` = `chat_message`.`id`),
  `total_tokens` = (SELECT MAX(`total_tokens`) FROM `message_part` WHERE `message_id` = `chat_message`.`id`);--> statement-breakpoint
ALTER TABLE `message_part` DROP COLUMN `input_total_tokens`;--> statement-breakpoint
ALTER TABLE `message_part` DROP COLUMN `input_no_cache_tokens`;--> statement-breakpoint
ALTER TABLE `message_part` DROP COLUMN `input_cache_read_tokens`;--> statement-breakpoint
ALTER TABLE `message_part` DROP COLUMN `input_cache_write_tokens`;--> statement-breakpoint
ALTER TABLE `message_part` DROP COLUMN `output_total_tokens`;--> statement-breakpoint
ALTER TABLE `message_part` DROP COLUMN `output_text_tokens`;--> statement-breakpoint
ALTER TABLE `message_part` DROP COLUMN `output_reasoning_tokens`;--> statement-breakpoint
ALTER TABLE `message_part` DROP COLUMN `total_tokens`;