export interface McpEndpointSettings {
	enabled: boolean;
	subAgentModeEnabled: boolean;
	contextLayerModeEnabled: boolean;
}

export const DEFAULT_MCP_ENDPOINT_SETTINGS: McpEndpointSettings = {
	enabled: false,
	subAgentModeEnabled: true,
	contextLayerModeEnabled: true,
};
