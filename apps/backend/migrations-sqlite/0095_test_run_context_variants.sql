ALTER TABLE `test_run` ADD `context_changes` text;--> statement-breakpoint
ALTER TABLE `test_run_result` ADD `context_variant` text DEFAULT 'production' NOT NULL;