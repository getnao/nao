import type { LlmSelectedModel } from '@nao/shared/types';

export interface McpEndpointSettings {
	enabled: boolean;
	subAgentModeEnabled: boolean;
	contextLayerModeEnabled: boolean;
	/** The model `ask_nao` runs on; null or unset follows the project's default chat model. */
	subAgentModel?: LlmSelectedModel | null;
}

export const DEFAULT_MCP_ENDPOINT_SETTINGS: McpEndpointSettings = {
	enabled: false,
	subAgentModeEnabled: true,
	contextLayerModeEnabled: true,
};
