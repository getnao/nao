ALTER TABLE "mcp_query_data" ADD COLUMN "sql_query" text;--> statement-breakpoint
ALTER TABLE "mcp_query_data" ADD COLUMN "database_id" text;--> statement-breakpoint
UPDATE "mcp_query_data"
SET
	"sql_query" = "mcp_call_log"."tool_input"->>'sql_query',
	"database_id" = "mcp_call_log"."tool_input"->>'database_id'
FROM "mcp_call_log"
WHERE "mcp_call_log"."id" = "mcp_query_data"."call_log_id"
	AND "mcp_call_log"."tool_name" = 'execute_sql';
