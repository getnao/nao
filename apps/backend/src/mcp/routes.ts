import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { App } from '../app';
import { env } from '../env';
import { getMcpEndpointSettings } from '../queries/mcp-endpoint.queries';
import { resolveUserId } from './auth';
import { createMcpServer, resolveProjectId, sessions } from './server';

declare module 'fastify' {
	interface FastifyRequest {
		mcpUserId: string;
	}
}

export const mcpServerRoutes = async (app: App) => {
	app.addHook('preHandler', requireAuthenticatedMcpUser);

	app.get('/', (request, reply) => handleExistingSession(request, reply));

	app.post('/', async (request, reply) => {
		const existingSessionId = request.headers['mcp-session-id'] as string | undefined;
		if (existingSessionId) {
			return handleExistingSession(request, reply, request.body);
		}
		return initializeSession(request, reply);
	});

	app.delete('/', (request, reply) => handleExistingSession(request, reply));
};

async function requireAuthenticatedMcpUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
	const userId = await resolveUserId(request);
	if (!userId) {
		replyUnauthorized(reply);
		return;
	}
	request.mcpUserId = userId;
}

async function initializeSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
	const userId = request.mcpUserId;
	const projectId = await resolveProjectId(userId);
	const settings = await getMcpEndpointSettings(projectId);
	if (!settings.enabled) {
		reply.status(503).send({ error: 'MCP is disabled for this workspace.' });
		return;
	}

	const server = createMcpServer(userId, projectId, settings);
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: () => crypto.randomUUID(),
		enableJsonResponse: true,
		onsessioninitialized: (sessionId) => {
			sessions.set(sessionId, { transport, server, userId, projectId, lastAccess: Date.now() });
		},
		onsessionclosed: (sessionId) => {
			sessions.delete(sessionId);
			server.close().catch(() => {});
		},
	});

	await server.connect(transport);
	await transport.handleRequest(request.raw, reply.raw, request.body as Record<string, unknown>);
	reply.hijack();
}

async function handleExistingSession(request: FastifyRequest, reply: FastifyReply, body?: unknown): Promise<void> {
	const sessionId = request.headers['mcp-session-id'] as string | undefined;
	if (!sessionId) {
		reply.status(400).send({ error: 'Missing Mcp-Session-Id header.' });
		return;
	}

	const session = sessions.get(sessionId);
	if (!session || session.userId !== request.mcpUserId) {
		reply.status(404).send({ error: 'Session not found or expired. Please reinitialize.' });
		return;
	}

	const settings = await getMcpEndpointSettings(session.projectId);
	if (!settings.enabled) {
		sessions.delete(sessionId);
		await session.transport.close().catch(() => {});
		await session.server.close().catch(() => {});
		reply.status(503).send({ error: 'MCP is disabled for this workspace.' });
		return;
	}

	session.lastAccess = Date.now();
	await session.transport.handleRequest(request.raw, reply.raw, body as Record<string, unknown> | undefined);
	reply.hijack();
}

function replyUnauthorized(reply: FastifyReply) {
	const origin = env.BETTER_AUTH_URL.replace(/\/+$/, '');
	const wwwAuth = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
	return reply
		.status(401)
		.header('WWW-Authenticate', wwwAuth)
		.header('Access-Control-Expose-Headers', 'WWW-Authenticate')
		.send({ error: 'Unauthorized. Provide a valid Bearer token in the Authorization header.' });
}
