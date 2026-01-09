import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, ToolLoopAgent } from 'ai';
import { z } from 'zod/v4';

import { tools } from '../agents/tools';
import type { App } from '../app';
import { Chat, Message } from '../types/chat';
import { chatStorage } from '../utils/chatStorage';

const DEBUG_CHUNKS = false;

export const chatPlugin = async (app: App) => {
	app.post(
		'/agent',
		{ schema: { body: z.object({ message: z.custom<Message>(), chatId: z.string().optional() }) } },
		async (request) => {
			const newMessage = request.body.message;
			let chatId = request.body.chatId;
			let chat: Chat | undefined;
			const isNewChat = !chatId;

			if (!chatId) {
				const title = newMessage.parts.find((part) => part.type === 'text')?.text.slice(0, 64);
				chat = await chatStorage.createChat({ title, messages: [request.body.message] });
				chatId = chat.id;
			} else {
				chat = await chatStorage.addMessages(chatId, [request.body.message]);
			}

			const agent = new ToolLoopAgent({
				model: openai.chat('gpt-5.1'),
				tools,
			});

			let stream = createUIMessageStream<Message>({
				execute: async ({ writer }) => {
					if (isNewChat) {
						writer.write({
							type: 'data-newChat',
							data: {
								...chat,
								createdAt: Date.now(),
								updatedAt: Date.now(),
							},
						});
					}

					const result = await agent.stream({
						messages: await convertToModelMessages(chat.messages as Message[]),
					});

					writer.merge(result.toUIMessageStream({}));
				},
				onFinish: async (e) => {
					console.log(e.messages);
					await chatStorage.addMessages(chatId, e.messages);
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
