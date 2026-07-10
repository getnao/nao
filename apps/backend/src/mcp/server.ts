import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { listUserProjects } from '../queries/project.queries';
import type { McpEndpointSettings } from '../types/mcp-endpoint';
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

export function createMcpServer(userId: string, projectId: string, settings: McpEndpointSettings): McpServer {
	const server = new McpServer({ name: 'nao', version: '0.1.0' }, { capabilities: { tools: {}, resources: {} } });
	const ctx = { userId, projectId, settings };

	if (settings.subAgentModeEnabled) {
		registerSubAgentTools(server, ctx);
	}
	if (settings.contextLayerModeEnabled) {
		registerContextLayerTools(server, ctx);
	}

	if (settings.subAgentModeEnabled || settings.contextLayerModeEnabled) {
		registerAssetTools(server, ctx);
	}

	registerNaoMcpApps(server);

	return server;
}
