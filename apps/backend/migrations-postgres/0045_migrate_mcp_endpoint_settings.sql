UPDATE "project"
SET "mcp_endpoint_settings" = jsonb_set(
	"mcp_endpoint_settings",
	'{subAgentModeEnabled}',
	"mcp_endpoint_settings"->'agentModeEnabled'
)
WHERE "mcp_endpoint_settings" ? 'agentModeEnabled';
--> statement-breakpoint
UPDATE "project"
SET "mcp_endpoint_settings" = jsonb_set(
	"mcp_endpoint_settings",
	'{contextLayerModeEnabled}',
	"mcp_endpoint_settings"->'toolsModeEnabled'
)
WHERE "mcp_endpoint_settings" ? 'toolsModeEnabled';
--> statement-breakpoint
UPDATE "project"
SET "mcp_endpoint_settings" = "mcp_endpoint_settings"
	- 'agentModeEnabled'
	- 'toolsModeEnabled'
	- 'objectsModeEnabled'
WHERE "mcp_endpoint_settings" ?| array['agentModeEnabled', 'toolsModeEnabled', 'objectsModeEnabled'];
