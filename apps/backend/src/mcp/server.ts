import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getCustomBoundaries, listUserProjects } from '../queries/project.queries';
import type { McpEndpointSettings } from '../types/mcp-endpoint';
import { CHART_DATA_MODE_SERVER_INSTRUCTIONS } from './chart-data-mode';
import { registerNaoMcpApps } from './embed/ui-resources';
import { registerAssetTools } from './tools/asset-tools';
import { registerContextLayerTools } from './tools/context-layer';
import { registerSubAgentTools } from './tools/sub-agent';

export async function resolveProjectId(userId: string): Promise<string> {
	const projects = await listUserProjects(userId);
	if (projects.length === 0) {
		throw new Error('No projects found for this user. Create or join a project first.');
	}
	if (projects.length === 1) {
		return projects[0].id;
	}

	const listing = projects.map((p) => `  - ${p.name} (${p.id})`).join('\n');
	throw new Error(`MCP only supports single-project workspaces. Multiple projects found for this user:\n${listing}`);
}

export async function createMcpServer(
	userId: string,
	projectId: string,
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
	const ctx = { userId, projectId, settings, chartDataMode };

	if (settings.subAgentModeEnabled) {
		registerSubAgentTools(server, ctx);
	}
	if (settings.contextLayerModeEnabled) {
		registerContextLayerTools(server, ctx);
	}

	if (settings.subAgentModeEnabled || settings.contextLayerModeEnabled) {
		const customBoundaries = await getCustomBoundaries(projectId);
		registerAssetTools(server, ctx, customBoundaries);
	}

	registerNaoMcpApps(server);

	return server;
}

const BASE_SERVER_INSTRUCTIONS =
	'nao answers analytics questions backed by SQL queries on the connected data sources. ' +
	'Default to `ask_nao` for analytics questions; prefer showing results as charts over text tables when the data suits it.';

const DATA_MODE_SERVER_INSTRUCTIONS = BASE_SERVER_INSTRUCTIONS + CHART_DATA_MODE_SERVER_INSTRUCTIONS;
