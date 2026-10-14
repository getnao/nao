import { JsonToSseTransformStream, UI_MESSAGE_STREAM_HEADERS } from 'ai';

import type { App } from '../app';
import { handleAgentRoute } from '../handlers/agent';
import { authMiddleware } from '../middleware/auth';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { assertProjectCloudBillingAccess } from '../services/cloud-billing-access.service';
import { posthog, PostHogEvent } from '../services/posthog';
import { AgentRequestSchema } from '../types/chat';
import { trackAgentStreamDisconnect } from '../utils/agent-stream-disconnect';
import { withSseKeepAlive } from '../utils/sse-keep-alive';

const DEBUG_CHUNKS = false;
const KEEP_ALIVE_INTERVAL_MS = 10_000;

export const agentRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post('/', { schema: { body: AgentRequestSchema } }, async (request, reply) => {
		const { user, project, body, headers } = request;
		let clientDisconnected = false;
		let stopAgent: (() => void) | undefined = undefined;
		const stopAgentOnDisconnect = () => {
			if (clientDisconnected) {
				return;
			}
			clientDisconnected = true;
			stopAgent?.();
		};
		request.raw.once('aborted', stopAgentOnDisconnect);
		reply.raw.once('close', () => {
			if (!reply.raw.writableEnded) {
				stopAgentOnDisconnect();
			}
		});

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
		});
		stopAgent = result.stop;
		if (clientDisconnected) {
			stopAgent();
		}

		posthog.capture(user.id, PostHogEvent.MessageSent, {
			project_id: projectId,
			chat_id: result.chatId,
			model_id: result.modelId,
			is_new_chat: result.isNewChat,
			source: body.adminMode && canChatWithNaoData ? 'admin' : 'web',
			domain_host: headers['x-forwarded-host'] || headers.host,
		});

		let stream = result.stream;

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
