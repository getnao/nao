import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { UserRole } from '@nao/shared/types';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { App } from '../app';
import { resolveMcpFacingOrigin } from '../env';
import { getMcpEndpointSettings } from '../queries/mcp-endpoint.queries';
import { getUserRoleInProject } from '../queries/project.queries';
import { resolveUserId } from './auth';
import { getMcpAppsBundle, MCP_APPS_SCRIPT_PATH } from './embed/mcp-apps-bundle';
import { createMcpServer, resolveProjectId } from './server';

declare module 'fastify' {
	interface FastifyRequest {
		mcpUserId: string;
		mcpProjectId: string;
		mcpRole: Exclude<UserRole, 'viewer'>;
	}
}

export const mcpServerRoutes = async (app: App) => {
	app.get(MCP_APPS_SCRIPT_PATH, async (_request, reply) => {
		return reply
			.header('content-type', 'application/javascript; charset=utf-8')
			.header('cache-control', 'public, max-age=3600, immutable')
			.send(getMcpAppsBundle());
	});

	await app.register(async (authenticated) => {
		authenticated.addHook('preHandler', requireAuthenticatedMcpUser);

		authenticated.post('/', (request, reply) => handleMcpRequest(request, reply));

		authenticated.get('/', (_request, reply) => replyMethodNotAllowed(reply));
		authenticated.delete('/', (_request, reply) => replyMethodNotAllowed(reply));
	});
};

async function requireAuthenticatedMcpUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
	const userId = await resolveUserId(request);
	if (!userId) {
		replyUnauthorized(request, reply);
		return;
	}
	const projectId = await resolveProjectId(userId);
	const role = await getUserRoleInProject(projectId, userId);
	if (!role || role === 'viewer') {
		reply.status(403).send({ error: 'You do not have access to this MCP endpoint.' });
		return;
	}

	request.mcpUserId = userId;
	request.mcpProjectId = projectId;
	request.mcpRole = role;
}

async function handleMcpRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
	const settings = await getMcpEndpointSettings(request.mcpProjectId);
	if (!settings.enabled) {
		reply.status(503).send({ error: 'MCP is disabled for this workspace.' });
		return;
	}

	const server = await createMcpServer(
		request.mcpUserId,
		request.mcpProjectId,
		settings,
		isChartDataModeRequest(request),
	);
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

	reply.raw.on('close', () => {
		transport.close().catch(() => {});
		server.close().catch(() => {});
	});

	await server.connect(transport);
	await transport.handleRequest(request.raw, reply.raw, request.body as Record<string, unknown>);
	reply.hijack();
}

function isChartDataModeRequest(request: FastifyRequest): boolean {
	const { chart_output } = request.query as { chart_output?: string };
	return chart_output?.toLowerCase() === 'data';
}

function replyMethodNotAllowed(reply: FastifyReply) {
	return reply
		.status(405)
		.header('Allow', 'POST')
		.send({
			jsonrpc: '2.0',
			error: { code: -32000, message: 'Method not allowed in stateless mode.' },
			id: null,
		});
}

function replyUnauthorized(request: FastifyRequest, reply: FastifyReply) {
	const origin = resolveMcpFacingOrigin(request.host);
	const wwwAuth = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
	return reply
		.status(401)
		.header('WWW-Authenticate', wwwAuth)
		.header('Access-Control-Expose-Headers', 'WWW-Authenticate')
		.send({ error: 'Unauthorized. Provide a valid Bearer token in the Authorization header.' });
}
