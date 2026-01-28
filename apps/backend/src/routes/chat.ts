import { createUIMessageStreamResponse } from 'ai';
import { z } from 'zod/v4';

import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import * as chatQueries from '../queries/chat.queries';
import { agentService, ModelSelection } from '../services/agent.service';
import { UIMessage } from '../types/chat';
import { llmProviderSchema } from '../types/llm';

const DEBUG_CHUNKS = false;

const modelSelectionSchema = z
	.object({
		provider: llmProviderSchema,
		modelId: z.string(),
	})
	.optional();

export const chatRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post(
		'/agent',
		{
			schema: {
				body: z.object({
					message: z.custom<UIMessage>(),
					chatId: z.string().optional(),
					model: modelSelectionSchema,
				}),
			},
		},
		async (request, reply) => {
			const abortController = new AbortController();
			const userId = request.user.id;
			const projectId = request.project?.id;
			const message = request.body.message;
			let chatId = request.body.chatId;
			const modelSelection = request.body.model as ModelSelection | undefined;
			const isNewChat = !chatId;

			if (!projectId) {
				return reply
					.status(400)
					.send({ error: 'No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.' });
			}

			if (!chatId) {
				// If no id, we create a new chat and insert the first message
				const title = message.parts.find((part) => part.type === 'text')?.text.slice(0, 64);
				const createdChat = await chatQueries.createChat({ title, userId, projectId }, message);
				chatId = createdChat.id;
			} else {
				// update the existing chat with the new message
				await chatQueries.upsertMessage(message, { chatId });
			}

			const [chat, chatUserId] = await chatQueries.loadChat(chatId);
			if (!chat) {
				return reply.status(404).send({ error: `Chat with id ${chatId} not found.` });
			}

			const isAuthorized = chatUserId === userId;
			if (!isAuthorized) {
				return reply.status(403).send({ error: `You are not authorized to access this chat.` });
			}

			const agent = await agentService.create({ ...chat, userId, projectId }, abortController, modelSelection);

			let stream = agent.stream(chat.messages as UIMessage[], {
				sendNewChatData: !!isNewChat,
			});

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
