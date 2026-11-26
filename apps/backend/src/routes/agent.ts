import { JsonToSseTransformStream, UI_MESSAGE_STREAM_HEADERS } from 'ai';
import type { IncomingHttpHeaders } from 'http';
import { z } from 'zod/v4';

import type { App } from '../app';
import { handleAgentRoute } from '../handlers/agent';
import { authMiddleware } from '../middleware/auth';
import { getChatOwnerId } from '../queries/chat.queries';
import { authorizeAgentRun } from '../services/agent-run';
import { agentStreamService, type OpenAgentStream } from '../services/agent-stream';
import { AgentRequestSchema } from '../types/chat';
import { trackAgentStreamDisconnect } from '../utils/agent-stream-disconnect';
import { HandlerError } from '../utils/error';
import { withQueryResultPreviewsInStream } from '../utils/query-result-preview';
import { consumeRateLimit } from '../utils/rate-limiter';
import { withSseKeepAlive } from '../utils/sse-keep-alive';

const DEBUG_CHUNKS = false;
const KEEP_ALIVE_INTERVAL_MS = 10_000;

const streamParamsSchema = z.object({
	chatId: z.string(),
});

export const agentRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post('/', { schema: { body: AgentRequestSchema } }, async (request, reply) => {
		const { user, project, body, headers } = request;
		consumeRateLimit('agent', user.id, user.id);
		const run = await authorizeAgentRun({ userId: user.id, currentProject: project, body });
		let answer: OpenAgentStream | undefined;

		const result = await handleAgentRoute({
			...body,
			userId: user.id,
			projectId: run.projectId,
			profile: run.profile,
			model: run.model,
			unbilledManagedAiUsage: run.unbilledManagedAiUsage,
			billingAccessVerifiedProjectId: run.projectId,
			domainHost: getDomainHost(headers),
			onUserMessageSaved: (chatId) => {
				answer = agentStreamService.open(chatId, user.id);
			},
		}).catch(async (error) => {
			answer?.fail();
			await run.release?.();
			throw error;
		});

		answer ??= agentStreamService.open(result.chatId, user.id);
		let stream = answer.start(withQueryResultPreviewsInStream(result.stream));

		if (DEBUG_CHUNKS) {
			stream = stream.pipeThrough(
				new TransformStream({
					transform: async (chunk, controller) => {
						console.log(chunk);
						controller.enqueue(chunk);
						await new Promise((resolve) => setTimeout(resolve, 100));
					},
				}),
			);
		}

		const sseStream = trackAgentStreamDisconnect(stream, {
			request,
			reply,
			agent: result.agent,
			userId: user.id,
			projectId: run.projectId,
			chatId: result.chatId,
			modelId: result.modelId,
		}).pipeThrough(new JsonToSseTransformStream());

		return createAgentStreamResponse(sseStream);
	});

	/** Where a client reconnects after a reload: replays the chat's running answer, or 204 when none runs. */
	app.get('/:chatId/stream', { schema: { params: streamParamsSchema } }, async (request, reply) => {
		const { chatId } = request.params;
		if ((await getChatOwnerId(chatId)) !== request.user.id) {
			throw new HandlerError('NOT_FOUND', `Chat with id ${chatId} not found.`);
		}

		const stream = await agentStreamService.read(chatId);
		if (!stream) {
			return reply.status(204).send();
		}
		return createAgentStreamResponse(stream.pipeThrough(new JsonToSseTransformStream()));
	});
};

function createAgentStreamResponse(stream: ReadableStream): Response {
	return new Response(withSseKeepAlive(stream, KEEP_ALIVE_INTERVAL_MS).pipeThrough(new TextEncoderStream()), {
		headers: {
			...UI_MESSAGE_STREAM_HEADERS,
			'x-accel-buffering': 'no',
			'cache-control': 'no-cache, no-transform',
		},
	});
}

function getDomainHost(headers: IncomingHttpHeaders): string | undefined {
	const host = headers['x-forwarded-host'] || headers.host;
	return Array.isArray(host) ? host[0] : host;
}
