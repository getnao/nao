ALTER TABLE `message_part` ADD `input_total_tokens` integer;--> statement-breakpoint
ALTER TABLE `message_part` ADD `input_no_cache_tokens` integer;--> statement-breakpoint
ALTER TABLE `message_part` ADD `input_cache_read_tokens` integer;--> statement-breakpoint
ALTER TABLE `message_part` ADD `input_cache_write_tokens` integer;--> statement-breakpoint
ALTER TABLE `message_part` ADD `output_total_tokens` integer;--> statement-breakpoint
ALTER TABLE `message_part` ADD `output_text_tokens` integer;--> statement-breakpoint
ALTER TABLE `message_part` ADD `output_reasoning_tokens` integer;--> statement-breakpoint
ALTER TABLE `message_part` ADD `total_tokens` integer;