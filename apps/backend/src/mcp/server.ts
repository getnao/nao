import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getCustomBoundaries, getProjectById } from '../queries/project.queries';
import { resolveSemanticLayerMode } from '../services/semantic-layer.service';
import { isCustomStoriesEnabled } from '../services/story-mount';
import { hasUserGroupFeature } from '../services/user-group-feature-access.service';
import type { McpEndpointSettings, McpUserRole } from '../types/mcp-endpoint';
import { extractConfiguredDatabases } from '../utils/nao-config';
import { CHART_DATA_MODE_SERVER_INSTRUCTIONS } from './chart-data-mode';
import { registerNaoMcpApps } from './embed/ui-resources';
import { registerAssetTools } from './tools/asset-tools';
import { registerContextAdminTools } from './tools/context-admin-tools';
import { registerContextLayerTools } from './tools/context-layer';
import { registerSubAgentTools } from './tools/sub-agent';

export async function createMcpServer(
	userId: string,
	projectId: string,
	role: McpUserRole,
	settings: McpEndpointSettings,
	chartDataMode = false,
): Promise<McpServer> {
	const server = new McpServer(
		{ name: 'nao', version: '0.1.0' },
		{
			capabilities: { tools: {}, resources: {} },
			instructions: chartDataMode ? DATA_MODE_SERVER_INSTRUCTIONS : BASE_SERVER_INSTRUCTIONS,
		},
	);
	const storyCreationEnabled = await hasUserGroupFeature(projectId, userId, 'storyCreation');
	const customStoryCreationEnabled =
		storyCreationEnabled &&
		isCustomStoriesEnabled() &&
		(await hasUserGroupFeature(projectId, userId, 'customStoryCreation'));
	const ctx = { userId, projectId, role, settings, chartDataMode, storyCreationEnabled, customStoryCreationEnabled };

	if (settings.subAgentModeEnabled) {
		await registerSubAgentTools(server, ctx);
	}
	if (settings.contextLayerModeEnabled) {
		const project = await getProjectById(projectId);
		const configuredDatabases = project?.path ? extractConfiguredDatabases(project.path) : [];
		const semanticLayerMode = project?.path ? resolveSemanticLayerMode(project.path, project.agentSettings) : null;
		registerContextLayerTools(server, ctx, configuredDatabases, semanticLayerMode);
	}

	if (settings.subAgentModeEnabled || settings.contextLayerModeEnabled) {
		const customBoundaries = await getCustomBoundaries(projectId);
		registerAssetTools(server, ctx, customBoundaries);
	}

	registerContextAdminTools(server, ctx);
	registerNaoMcpApps(server);

	return server;
}

const BASE_SERVER_INSTRUCTIONS =
	'nao answers analytics questions backed by SQL queries on the connected data sources. ' +
	'Default to `ask_nao` for analytics questions; prefer showing results as charts over text tables when the data suits it.';

const DATA_MODE_SERVER_INSTRUCTIONS = BASE_SERVER_INSTRUCTIONS + CHART_DATA_MODE_SERVER_INSTRUCTIONS;
