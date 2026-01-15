import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
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
};
