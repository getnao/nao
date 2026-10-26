CREATE TABLE `test_run` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`triggered_by_user_id` text,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`context_ref` text,
	`context_commit` text,
	`models` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`selection` text,
	`total_attempts` integer DEFAULT 0 NOT NULL,
	`completed_attempts` integer DEFAULT 0 NOT NULL,
	`passed_attempts` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`total_cost` real,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `test_run_projectId_idx` ON `test_run` (`project_id`);--> statement-breakpoint
CREATE INDEX `test_run_status_idx` ON `test_run` (`status`);--> statement-breakpoint
CREATE TABLE `test_run_result` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`test_path` text NOT NULL,
	`test_name` text NOT NULL,
	`test_hash` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`llm_provider` text NOT NULL,
	`llm_model_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`passed` integer NOT NULL,
	`message` text NOT NULL,
	`error_message` text,
	`chat_id` text,
	`total_tokens` integer,
	`total_cost` real,
	`duration_ms` integer,
	`tool_call_count` integer,
	`details` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `test_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `test_run_result_runId_idx` ON `test_run_result` (`run_id`);--> statement-breakpoint
CREATE INDEX `test_run_result_chatId_idx` ON `test_run_result` (`chat_id`);--> statement-breakpoint
CREATE INDEX `test_run_result_testPath_idx` ON `test_run_result` (`test_path`);