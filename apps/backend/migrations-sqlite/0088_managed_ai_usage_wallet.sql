CREATE TABLE `credit_grant_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_type` text NOT NULL,
	`org_id` text,
	`user_id` text,
	`project_id` text,
	`source_key` text NOT NULL,
	`activated_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`grant_type`) REFERENCES `credit_grant_policy`(`grant_type`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_grant_candidate_source_key_unique` ON `credit_grant_candidate` (`source_key`);--> statement-breakpoint
CREATE INDEX `credit_grant_candidate_orgId_grantType_idx` ON `credit_grant_candidate` (`org_id`,`grant_type`);--> statement-breakpoint
CREATE INDEX `credit_grant_candidate_userId_grantType_idx` ON `credit_grant_candidate` (`user_id`,`grant_type`);--> statement-breakpoint
CREATE INDEX `credit_grant_candidate_projectId_grantType_idx` ON `credit_grant_candidate` (`project_id`,`grant_type`);--> statement-breakpoint
CREATE TABLE `credit_grant_policy` (
	`grant_type` text PRIMARY KEY NOT NULL,
	`amount_micro_usd` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `credit_grant_policy` (`grant_type`, `amount_micro_usd`) VALUES
	('organization_setup', 20000000),
	('user_join', 5000000);
--> statement-breakpoint
INSERT OR IGNORE INTO `credit_grant_candidate` (
	`id`,
	`grant_type`,
	`org_id`,
	`project_id`,
	`source_key`,
	`created_at`
)
SELECT
	'legacy-project-setup:' || `project`.`id`,
	'organization_setup',
	`project`.`org_id`,
	`project`.`id`,
	'project:' || `project`.`id`,
	`project`.`created_at`
FROM `project`
WHERE `project`.`org_id` IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `credit_grant_candidate` (
	`id`,
	`grant_type`,
	`org_id`,
	`user_id`,
	`source_key`,
	`activated_at`,
	`created_at`
)
SELECT
	'legacy-org-member:' || `org_member`.`org_id` || ':' || `org_member`.`user_id`,
	'user_join',
	`org_member`.`org_id`,
	`org_member`.`user_id`,
	'org-member:' || `org_member`.`org_id` || ':' || `org_member`.`user_id`,
	CASE
		WHEN NOT `user`.`requires_password_reset`
			OR EXISTS (SELECT 1 FROM `session` WHERE `session`.`user_id` = `org_member`.`user_id`)
		THEN cast(unixepoch('subsecond') * 1000 as integer)
		ELSE NULL
	END,
	`org_member`.`created_at`
FROM `org_member`
INNER JOIN `user` ON `user`.`id` = `org_member`.`user_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `credit_grant_candidate` (
	`id`,
	`grant_type`,
	`org_id`,
	`user_id`,
	`project_id`,
	`source_key`,
	`activated_at`,
	`created_at`
)
SELECT
	'legacy-project-member:' || `project_member`.`project_id` || ':' || `project_member`.`user_id`,
	'user_join',
	`project`.`org_id`,
	`project_member`.`user_id`,
	`project_member`.`project_id`,
	'project-member:' || `project_member`.`project_id` || ':' || `project_member`.`user_id`,
	CASE
		WHEN NOT `user`.`requires_password_reset`
			OR EXISTS (SELECT 1 FROM `session` WHERE `session`.`user_id` = `project_member`.`user_id`)
		THEN cast(unixepoch('subsecond') * 1000 as integer)
		ELSE NULL
	END,
	`project_member`.`created_at`
FROM `project_member`
INNER JOIN `project` ON `project`.`id` = `project_member`.`project_id`
INNER JOIN `user` ON `user`.`id` = `project_member`.`user_id`
WHERE `project`.`org_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text,
	`usage_id` text,
	`entry_type` text NOT NULL,
	`delta_micro_usd` integer NOT NULL,
	`balance_after_micro_usd` integer NOT NULL,
	`transaction_sequence` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text NOT NULL,
	`external_reference` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `credit_wallet`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`usage_id`) REFERENCES `managed_ai_usage`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_usage_id_unique` ON `credit_ledger` (`usage_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_idempotency_key_unique` ON `credit_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_ledger_walletId_createdAt_idx` ON `credit_ledger` (`wallet_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `credit_wallet` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`balance_micro_usd` integer DEFAULT 0 NOT NULL,
	`ledger_sequence` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_wallet_orgId_idx` ON `credit_wallet` (`org_id`);--> statement-breakpoint
CREATE TABLE `managed_ai_usage` (
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
	`input_no_cache_rate_micro_usd_per_million_tokens` integer,
	`input_cache_read_rate_micro_usd_per_million_tokens` integer,
	`input_cache_write_rate_micro_usd_per_million_tokens` integer,
	`output_rate_micro_usd_per_million_tokens` integer,
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
CREATE UNIQUE INDEX `managed_ai_usage_operation_id_unique` ON `managed_ai_usage` (`operation_id`);--> statement-breakpoint
CREATE INDEX `managed_ai_usage_orgId_startedAt_idx` ON `managed_ai_usage` (`org_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `managed_ai_usage_userId_startedAt_idx` ON `managed_ai_usage` (`user_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `managed_ai_usage_userId_runId_idx` ON `managed_ai_usage` (`user_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `managed_ai_usage_projectId_startedAt_idx` ON `managed_ai_usage` (`project_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `managed_ai_usage_chatId_idx` ON `managed_ai_usage` (`chat_id`);--> statement-breakpoint
CREATE INDEX `managed_ai_usage_chatMessageId_idx` ON `managed_ai_usage` (`chat_message_id`);--> statement-breakpoint
CREATE INDEX `managed_ai_usage_status_idx` ON `managed_ai_usage` (`status`);