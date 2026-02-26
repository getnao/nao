CREATE TABLE `llm_inference` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text,
	`type` text NOT NULL,
	`llm_provider` text NOT NULL,
	`llm_model_id` text NOT NULL,
	`input_total_tokens` integer,
	`input_no_cache_tokens` integer,
	`input_cache_read_tokens` integer,
	`input_cache_write_tokens` integer,
	`output_total_tokens` integer,
	`output_text_tokens` integer,
	`output_reasoning_tokens` integer,
	`total_tokens` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `llm_inference_projectId_idx` ON `llm_inference` (`project_id`);--> statement-breakpoint
CREATE INDEX `llm_inference_userId_idx` ON `llm_inference` (`user_id`);--> statement-breakpoint
CREATE INDEX `llm_inference_type_idx` ON `llm_inference` (`type`);--> statement-breakpoint
ALTER TABLE `memories` ADD `superseded_by` text;--> statement-breakpoint
CREATE INDEX `memories_supersededBy_idx` ON `memories` (`superseded_by`);