import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';

import type { App } from '../app';
import { handleAgentRoute } from '../handlers/agent';
import { authMiddleware } from '../middleware/auth';
import { posthog, PostHogEvent } from '../services/posthog';
import { AgentRequestSchema } from '../types/chat';
import { logger } from '../utils/logger';

const DEBUG_CHUNKS = false;

const STREAM_RESPONSE_HEADERS = {
	'X-Accel-Buffering': 'no',
	'Cache-Control': 'no-cache, no-transform',
};

export const agentRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post('/', { schema: { body: AgentRequestSchema } }, async ({ user, project, body, headers }) => {
		const projectId = project?.id;

		let result;
		try {
			result = await handleAgentRoute({
				userId: user.id,
				projectId,
				...body,
			});
		} catch (err) {
			logger.error(`Agent route error: ${String(err)}`, { source: 'agent', projectId });
			const stream = createUIMessageStream({
				execute: async () => {
					throw err;
				},
				onError: (e) => String(e),
			});
			return createUIMessageStreamResponse({ stream, headers: STREAM_RESPONSE_HEADERS });
		}

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
			headers: STREAM_RESPONSE_HEADERS,
		});
	});
};
