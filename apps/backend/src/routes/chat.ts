import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, ToolLoopAgent } from 'ai';
import { z } from 'zod/v4';

import { getInstructions } from '../agents/prompt';
import { tools } from '../agents/tools';
import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import * as chatQueries from '../queries/chatQueries';
import { UIMessage } from '../types/chat';

const DEBUG_CHUNKS = false;

export const chatRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post(
		'/agent',
		{ schema: { body: z.object({ message: z.custom<UIMessage>(), chatId: z.string().optional() }) } },
		async (request) => {
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
				await chatQueries.upsertMessage(chatId, message);
			}

			const chat = await chatQueries.loadChat(chatId);
			const instructions = getInstructions();

			const agent = new ToolLoopAgent({
				model: openai.chat('gpt-5.1'),
				instructions,
				tools,
			});

			let stream = createUIMessageStream<UIMessage>({
				execute: async ({ writer }) => {
					if (isNewChat) {
						writer.write({
							type: 'data-newChat',
							data: {
								id: chatId,
								title: chat.title,
								createdAt: chat.createdAt,
								updatedAt: chat.updatedAt,
							},
						});
					}

					writer.write({
						type: 'start',
						messageId: crypto.randomUUID(),
					});
					writer.write({
						type: 'start-step',
					});

					const result = await agent.stream({
						messages: await convertToModelMessages(chat.messages as UIMessage[]),
					});

					writer.merge(result.toUIMessageStream({ sendStart: false }));
				},
				originalMessages: chat.messages as UIMessage[],
				onFinish: async (e) => {
					console.log('onFinish');
					await chatQueries.upsertMessage(chatId, e.responseMessage);
				},
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
