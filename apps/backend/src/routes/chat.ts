import { createUIMessageStreamResponse } from 'ai';
import { z } from 'zod/v4';

import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import * as chatQueries from '../queries/chatQueries';
import { agentService } from '../services/agentService';
import { UIMessage } from '../types/chat';

const DEBUG_CHUNKS = false;

export const chatRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post(
		'/agent',
		{ schema: { body: z.object({ message: z.custom<UIMessage>(), chatId: z.string().optional() }) } },
		async (request) => {
			const abortController = new AbortController();
			const userId = request.user.id;
			const message = request.body.message;
			let chatId = request.body.chatId;
			const isNewChat = !chatId;

			if (!chatId) {
				// If no id, we create a new chat and insert the first message
				const title = message.parts.find((part) => part.type === 'text')?.text.slice(0, 64);
				const createdChat = await chatQueries.createChat({ title, userId }, message);
				chatId = createdChat.id;
			} else {
				// update the existing chat with the new message
				await chatQueries.upsertMessage(message, { chatId });
			}

			const chat = await chatQueries.loadChat(chatId);

			const agent = agentService.create({ ...chat, userId }, abortController);

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

			return createUIMessageStreamResponse({ stream });
		},
	);
};
