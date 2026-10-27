import type { LlmSelectedModel, UserRole } from '@nao/shared/types';

/** Viewers are rejected before an MCP server is built, so every MCP caller has one of these roles. */
export type McpUserRole = Exclude<UserRole, 'viewer'>;

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
