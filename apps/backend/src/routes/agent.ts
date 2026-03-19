import { createUIMessageStreamResponse } from 'ai';

import type { App } from '../app';
import { handleAgentRoute } from '../handlers/agent';
import { authMiddleware } from '../middleware/auth';
import { agentService } from '../services/agent';
import { posthog, PostHogEvent } from '../services/posthog';
import { AgentRequestSchema } from '../types/chat';

const DEBUG_CHUNKS = false;

const STREAMING_HEADERS = {
	'X-Accel-Buffering': 'no',
	'Cache-Control': 'no-cache, no-transform',
} as const;

export const agentRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post('/', { schema: { body: AgentRequestSchema } }, async ({ user, project, body, headers }) => {
		const projectId = project?.id;

		const result = await handleAgentRoute({
			userId: user.id,
			projectId,
			...body,
		});

		posthog.capture(user.id, PostHogEvent.MessageSent, {
			project_id: projectId,
			chat_id: result.chatId,
			model_id: result.modelId,
			is_new_chat: result.isNewChat,
			source: 'web',
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

		return createUIMessageStreamResponse({
			stream,
			headers: STREAMING_HEADERS,
		});
	});

	app.get<{ Params: { chatId: string } }>('/:chatId/stream', async ({ user, params }) => {
		const agent = agentService.get(params.chatId);
		if (!agent) {
			return new Response(null, { status: 204 });
		}
		if (!agent.checkIsUserOwner(user.id)) {
			return new Response('Forbidden', { status: 403 });
		}

		const stream = agent.resumeStream();
		if (!stream) {
			return new Response(null, { status: 204 });
		}

		return createUIMessageStreamResponse({
			stream,
			headers: STREAMING_HEADERS,
		});
	});
};
