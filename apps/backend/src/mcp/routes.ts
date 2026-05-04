import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { App } from '../app';
import { getMcpEndpointSettings } from '../queries/mcp-endpoint.queries';
import { resolveUserId } from './auth';
import { createMcpServer, resolveProjectId, sessions } from './server';

function replyUnauthorized(request: FastifyRequest, reply: FastifyReply) {
	const origin = `${request.protocol}://${request.headers.host ?? request.hostname}`;
	const wwwAuth = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
	return reply
		.status(401)
		.header('WWW-Authenticate', wwwAuth)
		.header('Access-Control-Expose-Headers', 'WWW-Authenticate')
		.send({ error: 'Unauthorized. Provide a valid Bearer token in the Authorization header.' });
}

export const mcpServerRoutes = async (app: App) => {
	app.post('/', async (request, reply) => {
		const userId = await resolveUserId(request);
		if (!userId) {
			return replyUnauthorized(request, reply);
		}

		const existingSessionId = request.headers['mcp-session-id'] as string | undefined;
		if (existingSessionId) {
			const session = sessions.get(existingSessionId);
			if (session && session.userId === userId) {
				session.lastAccess = Date.now();
				await session.transport.handleRequest(request.raw, reply.raw, request.body as Record<string, unknown>);
				reply.hijack();
				return;
			}
			return reply.status(404).send({ error: 'Session not found or expired. Please reinitialize.' });
		}

		const projectId = await resolveProjectId(userId);
		const settings = await getMcpEndpointSettings(projectId);
		if (!settings.enabled) {
			return reply.status(503).send({ error: 'MCP is disabled for this workspace.' });
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
	});

	app.get('/', async (request, reply) => {
		const userId = await resolveUserId(request);
		if (!userId) {
			return replyUnauthorized(request, reply);
		}

		const sessionId = request.headers['mcp-session-id'] as string | undefined;
		if (!sessionId) {
			return reply.status(400).send({ error: 'Missing Mcp-Session-Id header for SSE connection.' });
		}

		const session = sessions.get(sessionId);
		if (!session || session.userId !== userId) {
			return reply.status(404).send({ error: 'Session not found or expired.' });
		}

		session.lastAccess = Date.now();
		await session.transport.handleRequest(request.raw, reply.raw);
		reply.hijack();
	});

	app.delete('/', async (request, reply) => {
		const userId = await resolveUserId(request);
		if (!userId) {
			return replyUnauthorized(request, reply);
		}

		const sessionId = request.headers['mcp-session-id'] as string | undefined;
		const session = sessionId ? sessions.get(sessionId) : undefined;
		if (!session || session.userId !== userId) {
			return reply.status(400).send({ error: 'Invalid or missing session.' });
		}

		await session.transport.handleRequest(request.raw, reply.raw);
		reply.hijack();
	});
};
