export interface McpEndpointSettings {
	enabled: boolean;
	agentModeEnabled: boolean;
	toolsModeEnabled: boolean;
	objectsModeEnabled: boolean;
}

export const DEFAULT_MCP_ENDPOINT_SETTINGS: McpEndpointSettings = {
	enabled: false,
	agentModeEnabled: true,
	toolsModeEnabled: true,
	objectsModeEnabled: true,
};
