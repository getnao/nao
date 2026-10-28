import { JsonToSseTransformStream, UI_MESSAGE_STREAM_HEADERS } from 'ai';
import type { IncomingHttpHeaders } from 'http';

import type { App } from '../app';
import { handleAgentRoute } from '../handlers/agent';
import { authMiddleware } from '../middleware/auth';
import { authorizeAgentRun } from '../services/agent-run';
import { AgentRequestSchema } from '../types/chat';
import { trackAgentStreamDisconnect } from '../utils/agent-stream-disconnect';
import { withQueryResultPreviewsInStream } from '../utils/query-result-preview';
import { withSseKeepAlive } from '../utils/sse-keep-alive';

const DEBUG_CHUNKS = false;
const KEEP_ALIVE_INTERVAL_MS = 10_000;

export const agentRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post('/', { schema: { body: AgentRequestSchema } }, async (request, reply) => {
		const { user, project, body, headers } = request;
		const run = await authorizeAgentRun({ userId: user.id, currentProject: project, body });

		const result = await handleAgentRoute({
			...body,
			userId: user.id,
			projectId: run.projectId,
			profile: run.profile,
			model: run.model,
			unbilledManagedAiUsage: run.unbilledManagedAiUsage,
			billingAccessVerifiedProjectId: run.projectId,
			domainHost: getDomainHost(headers),
		}).catch(async (error) => {
			await run.release?.();
			throw error;
		});

		let stream = withQueryResultPreviewsInStream(result.stream);

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
