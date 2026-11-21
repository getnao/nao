import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { App } from '../app';
import { createLocalAgentMcpServer } from '../mcp/local-agent-server';
import { authMiddleware } from '../middleware/auth';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { completeLocalAgentTurn, startLocalAgentTurn } from '../services/local-agent.service';
import { getLocalAgentSession } from '../services/local-agent-session';
import { LocalAgentTurnCompletionSchema, LocalAgentTurnRequestSchema } from '../types/local-agent';
import { verifyLocalAgentToken } from '../utils/local-agent-token';

/** Turns the desktop app runs on the user's own Claude Code, and the nao tools they use. */
export const localAgentRoutes = async (app: App) => {
	app.register(localAgentTurnRoutes, { prefix: '/turns' });
	app.register(localAgentMcpRoutes, { prefix: '/mcp' });
};

const localAgentTurnRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post('/', { schema: { body: LocalAgentTurnRequestSchema } }, async (request) => {
		return startLocalAgentTurn({ userId: request.user.id, currentProject: request.project, request: request.body });
	});

	app.post('/complete', { schema: { body: LocalAgentTurnCompletionSchema } }, async (request) => {
		await completeLocalAgentTurn(request.user.id, request.body);
		return { ok: true };
	});
};

const localAgentMcpRoutes = async (app: App) => {
	app.post('/', handleMcpRequest);
	app.get('/', replyMethodNotAllowed);
	app.delete('/', replyMethodNotAllowed);
};

async function handleMcpRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
	const claims = verifyLocalAgentToken(readBearerToken(request) ?? '');
	if (!claims || !(await canStillUseChat(claims))) {
		reply.status(401).send({ error: 'Unauthorized' });
		return;
	}

	const session = await getLocalAgentSession({
		id: claims.chatId,
		userId: claims.userId,
		projectId: claims.projectId,
	});
	const server = createLocalAgentMcpServer(session);
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
	reply.raw.on('close', () => {
		transport.close().catch(() => {});
		server.close().catch(() => {});
	});

	await server.connect(transport);
	await transport.handleRequest(request.raw, reply.raw, request.body as Record<string, unknown>);
	reply.hijack();
}

/** The token outlives a turn, so access is checked again: the user may have left the project since. */
async function canStillUseChat(claims: { userId: string; projectId: string; chatId: string }): Promise<boolean> {
	const [ownerId, chatProjectId, role] = await Promise.all([
		chatQueries.getChatOwnerId(claims.chatId),
		chatQueries.getChatProjectId(claims.chatId),
		projectQueries.getUserRoleInProject(claims.projectId, claims.userId),
	]);
	return ownerId === claims.userId && chatProjectId === claims.projectId && !!role && role !== 'viewer';
}

function readBearerToken(request: FastifyRequest): string | null {
	const header = request.headers.authorization;
	return header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
}

function replyMethodNotAllowed(_request: FastifyRequest, reply: FastifyReply) {
	return reply
		.status(405)
		.header('Allow', 'POST')
		.send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed in stateless mode.' }, id: null });
}
