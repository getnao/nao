CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`run_id` text NOT NULL,
	`wallet_id` text,
	`user_id` text,
	`org_id` text,
	`project_id` text,
	`chat_id` text,
	`chat_message_id` text,
	`category` text NOT NULL,
	`llm_provider` text NOT NULL,
	`llm_model_id` text NOT NULL,
	`is_managed` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`finish_reason` text,
	`provider_request_id` text,
	`input_total_tokens` integer,
	`input_no_cache_tokens` integer DEFAULT 0 NOT NULL,
	`input_cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`input_cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`output_total_tokens` integer DEFAULT 0 NOT NULL,
	`output_text_tokens` integer,
	`output_reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer,
	`input_no_cache_rate_micro_usd` integer,
	`input_cache_read_rate_micro_usd` integer,
	`input_cache_write_rate_micro_usd` integer,
	`output_rate_micro_usd` integer,
	`input_no_cache_cost_micro_usd` integer,
	`input_cache_read_cost_micro_usd` integer,
	`input_cache_write_cost_micro_usd` integer,
	`output_cost_micro_usd` integer,
	`upstream_cost_micro_usd` integer,
	`customer_charge_micro_usd` integer DEFAULT 0 NOT NULL,
	`cost_source` text NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `credit_wallet`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_operation_id_unique` ON `ai_usage` (`operation_id`);--> statement-breakpoint
CREATE INDEX `ai_usage_orgId_createdAt_idx` ON `ai_usage` (`org_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_usage_userId_createdAt_idx` ON `ai_usage` (`user_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_usage_userId_runId_idx` ON `ai_usage` (`user_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `ai_usage_projectId_createdAt_idx` ON `ai_usage` (`project_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_usage_chatMessageId_idx` ON `ai_usage` (`chat_message_id`);--> statement-breakpoint
CREATE INDEX `ai_usage_status_idx` ON `ai_usage` (`status`);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text,
	`usage_id` text,
	`entry_type` text NOT NULL,
	`delta_micro_usd` integer NOT NULL,
	`balance_after_micro_usd` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`external_reference` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `credit_wallet`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`usage_id`) REFERENCES `ai_usage`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_usage_id_unique` ON `credit_ledger` (`usage_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_idempotency_key_unique` ON `credit_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_ledger_walletId_createdAt_idx` ON `credit_ledger` (`wallet_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `credit_wallet` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`balance_micro_usd` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_wallet_orgId_idx` ON `credit_wallet` (`org_id`);