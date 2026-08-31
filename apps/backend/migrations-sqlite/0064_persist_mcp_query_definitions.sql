ALTER TABLE `mcp_query_data` ADD `sql_query` text;--> statement-breakpoint
ALTER TABLE `mcp_query_data` ADD `database_id` text;--> statement-breakpoint
UPDATE `mcp_query_data`
SET
	`sql_query` = (
		SELECT json_extract(`mcp_call_log`.`tool_input`, '$.sql_query')
		FROM `mcp_call_log`
		WHERE `mcp_call_log`.`id` = `mcp_query_data`.`call_log_id`
	),
	`database_id` = (
		SELECT json_extract(`mcp_call_log`.`tool_input`, '$.database_id')
		FROM `mcp_call_log`
		WHERE `mcp_call_log`.`id` = `mcp_query_data`.`call_log_id`
	)
WHERE EXISTS (
	SELECT 1
	FROM `mcp_call_log`
	WHERE `mcp_call_log`.`id` = `mcp_query_data`.`call_log_id`
		AND `mcp_call_log`.`tool_name` = 'execute_sql'
);
