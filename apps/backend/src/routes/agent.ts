import { JsonToSseTransformStream, UI_MESSAGE_STREAM_HEADERS } from 'ai';
import type { IncomingHttpHeaders } from 'http';

import type { App } from '../app';
import { handleAgentRoute } from '../handlers/agent';
import { authMiddleware } from '../middleware/auth';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { assertProjectCloudBillingAccess } from '../services/cloud-billing-access.service';
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
		const projectId = body.chatId ? await chatQueries.getChatProjectId(body.chatId) : project?.id;

		let canChatWithNaoData = false;
		if (projectId) {
			const userRole = await projectQueries.getUserRoleInProject(projectId, user.id);
			if (!userRole || userRole === 'viewer') {
				return reply.status(403).send({ error: 'Viewers cannot send messages' });
			}
			canChatWithNaoData = userRole === 'admin' || userRole === 'context_admin';
			await assertProjectCloudBillingAccess(projectId);
		}

		const result = await handleAgentRoute({
			userId: user.id,
			projectId,
			...body,
			billingAccessVerifiedProjectId: projectId,
			adminMode: body.adminMode && canChatWithNaoData,
			domainHost: getDomainHost(headers),
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
			projectId,
			chatId: result.chatId,
			modelId: result.modelId,
		}).pipeThrough(new JsonToSseTransformStream());

		return new Response(withSseKeepAlive(sseStream, KEEP_ALIVE_INTERVAL_MS).pipeThrough(new TextEncoderStream()), {
			headers: {
				...UI_MESSAGE_STREAM_HEADERS,
				// Disable nginx buffering for streaming responses
				// This is critical for proper stream termination behind reverse proxies
				'x-accel-buffering': 'no',
				'cache-control': 'no-cache, no-transform',
			},
		});
	});
};

function getDomainHost(headers: IncomingHttpHeaders): string | undefined {
	const host = headers['x-forwarded-host'] || headers.host;
	return Array.isArray(host) ? host[0] : host;
}
