ALTER TABLE `mcp_call_log` ADD `test_attempt_id` text;--> statement-breakpoint
CREATE INDEX `mcp_call_log_testAttemptId_idx` ON `mcp_call_log` (`test_attempt_id`);