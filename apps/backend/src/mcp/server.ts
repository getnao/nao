import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { listUserProjects } from '../queries/project.queries';
import type { McpEndpointSettings } from '../types/mcp-endpoint';
import { registerNaoMcpApps } from './embed/ui-resources';
import { registerAgentTools } from './tools/agent';
import { registerDataTools } from './tools/data';
import { registerFileTools } from './tools/files';
import { registerStoryTools } from './tools/stories';

export interface McpSession {
	transport: StreamableHTTPServerTransport;
	server: McpServer;
	userId: string;
	projectId: string;
	lastAccess: number;
}

export const sessions = new Map<string, McpSession>();

const SESSION_TTL_MS = 30 * 60 * 1000;

setInterval(
	() => {
		const now = Date.now();
		for (const [id, session] of sessions) {
			if (now - session.lastAccess > SESSION_TTL_MS) {
				session.server.close().catch(() => {});
				sessions.delete(id);
			}
		}
	},
	5 * 60 * 1000,
).unref();

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
	const sessionChatRef: { lastChatId?: string } = {};
	const ctx = { userId, projectId, settings, sessionChatRef };

	if (settings.agentModeEnabled) {
		registerAgentTools(server, ctx);
	}
	if (settings.toolsModeEnabled) {
		registerDataTools(server, ctx);
		registerFileTools(server, ctx);
	}
	if (settings.objectsModeEnabled) {
		registerStoryTools(server, ctx);
	}

	if (settings.toolsModeEnabled || settings.objectsModeEnabled) {
		registerNaoMcpApps(server);
	}

	return server;
}

export async function closeProjectSessions(projectId: string): Promise<void> {
	const targets: McpSession[] = [];
	for (const [id, session] of sessions) {
		if (session.projectId === projectId) {
			targets.push(session);
			sessions.delete(id);
		}
	}
	await Promise.all(
		targets.map(async (session) => {
			await session.transport.close().catch(() => {});
			await session.server.close().catch(() => {});
		}),
	);
}
