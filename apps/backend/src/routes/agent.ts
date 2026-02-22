import { createUIMessageStreamResponse } from 'ai';

import type { App } from '../app';
import { handleAgentRoute } from '../handlers/agent';
import { authMiddleware } from '../middleware/auth';
import { posthog, PostHogEvent } from '../services/posthog.service';
import { AgentRequestSchema } from '../types/chat';

const DEBUG_CHUNKS = false;

export const agentRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post('/', { schema: { body: AgentRequestSchema } }, async ({ user, project, body }) => {
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
		});

		let stream = result.stream;

		if (DEBUG_CHUNKS) {
			stream = stream.pipeThrough(
				new TransformStream({
					transform: async (chunk, controller) => {
						console.log(chunk);
						controller.enqueue(chunk);
						await new Promise((resolve) => setTimeout(resolve, 250));
					},
				}),
			);
		}

		return createUIMessageStreamResponse({
			stream,
			headers: {
				// Disable nginx buffering for streaming responses
				// This is critical for proper stream termination behind reverse proxies
				'X-Accel-Buffering': 'no',
				'Cache-Control': 'no-cache, no-transform',
			},
		});
	});
};
