ALTER TABLE `chat_message` ADD `llm_provider` text;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `llm_model_id` text;--> statement-breakpoint
ALTER TABLE `user` ADD `requires_password_reset` integer DEFAULT false NOT NULL;