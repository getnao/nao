import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import { agentService } from '../services/agent.service';
import { type ListChatResponse, type UIChat } from '../types/chat';
import { protectedProcedure } from './trpc';

export const chatRoutes = {
	get: protectedProcedure.input(z.object({ chatId: z.string() })).query(async ({ input, ctx }): Promise<UIChat> => {
		const [chat, userId] = await chatQueries.loadChat(input.chatId, { includeFeedback: true });
		if (!chat) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
		}
		const isAuthorized = userId === ctx.user.id;
		if (!isAuthorized) {
			throw new TRPCError({ code: 'FORBIDDEN', message: `You are not authorized to access this chat.` });
		}
		return chat;
	}),

	list: protectedProcedure.query(async ({ ctx }): Promise<ListChatResponse> => {
		return chatQueries.listUserChats(ctx.user.id);
	}),

	delete: protectedProcedure.input(z.object({ chatId: z.string() })).mutation(async ({ input }): Promise<void> => {
		await chatQueries.deleteChat(input.chatId);
	}),

	stop: protectedProcedure.input(z.object({ chatId: z.string() })).mutation(async ({ input, ctx }): Promise<void> => {
		const agent = agentService.get(input.chatId);
		if (!agent) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Agent with id ${input.chatId} not found.` });
		}
		if (!agent.checkIsUserOwner(ctx.user.id)) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not allowed to stop this agent.' });
		}
		agent.stop();
	}),

	rename: protectedProcedure
		.input(z.object({ chatId: z.string(), title: z.string().min(1).max(255) }))
		.mutation(async ({ input, ctx }): Promise<void> => {
			const userId = await chatQueries.getChatOwnerId(input.chatId);
			if (!userId) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
			}
			if (userId !== ctx.user.id) {
				throw new TRPCError({ code: 'FORBIDDEN', message: `You are not authorized to rename this chat.` });
			}
			await chatQueries.renameChat(input.chatId, input.title);
		}),
};
