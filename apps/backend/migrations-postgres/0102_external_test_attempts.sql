ALTER TABLE "mcp_call_log" ADD COLUMN "test_attempt_id" text;--> statement-breakpoint
CREATE INDEX "mcp_call_log_testAttemptId_idx" ON "mcp_call_log" USING btree ("test_attempt_id");