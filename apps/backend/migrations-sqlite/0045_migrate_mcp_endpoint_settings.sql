UPDATE `project`
SET `mcp_endpoint_settings` = json_set(
	`mcp_endpoint_settings`,
	'$.subAgentModeEnabled',
	json(`mcp_endpoint_settings` -> '$.agentModeEnabled')
)
WHERE json_type(`mcp_endpoint_settings`, '$.agentModeEnabled') IS NOT NULL;
--> statement-breakpoint
UPDATE `project`
SET `mcp_endpoint_settings` = json_set(
	`mcp_endpoint_settings`,
	'$.contextLayerModeEnabled',
	json(`mcp_endpoint_settings` -> '$.toolsModeEnabled')
)
WHERE json_type(`mcp_endpoint_settings`, '$.toolsModeEnabled') IS NOT NULL;
--> statement-breakpoint
UPDATE `project`
SET `mcp_endpoint_settings` = json_remove(
	`mcp_endpoint_settings`,
	'$.agentModeEnabled',
	'$.toolsModeEnabled',
	'$.objectsModeEnabled'
)
WHERE json_type(`mcp_endpoint_settings`, '$.agentModeEnabled') IS NOT NULL
	OR json_type(`mcp_endpoint_settings`, '$.toolsModeEnabled') IS NOT NULL
	OR json_type(`mcp_endpoint_settings`, '$.objectsModeEnabled') IS NOT NULL;
