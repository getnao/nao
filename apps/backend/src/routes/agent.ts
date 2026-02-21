import { createUIMessageStreamResponse } from 'ai';
import { z } from 'zod/v4';

import type { App } from '../app';
import { handleAgentRoute } from '../handlers/agent';
import { authMiddleware } from '../middleware/auth';
import { posthog, PostHogEvent } from '../services/posthog.service';
import { UIMessage } from '../types/chat';
import { llmProviderSchema } from '../types/llm';

const DEBUG_CHUNKS = false;

const ModelSelectionSchema = z
	.object({
		provider: llmProviderSchema,
		modelId: z.string(),
	})
	.optional();

const MentionSchema = z.object({
	id: z.string(),
	trigger: z.string(),
	label: z.string(),
});

const AgentRequestSchema = z.object({
	message: z.custom<UIMessage>(),
	chatId: z.string().optional(),
	messageToEditId: z.string().optional(),
	model: ModelSelectionSchema,
	mentions: z.array(MentionSchema).optional(),
});

export type AgentRequest = z.infer<typeof AgentRequestSchema>;

export const agentRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post(
		'/',
		{
			schema: {
				body: AgentRequestSchema,
			},
		},
		async ({ user, project, body }) => {
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
		},
	);
};
