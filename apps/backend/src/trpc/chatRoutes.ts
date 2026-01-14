import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chatQueries';
import { type ListChatResponse, type UIChat } from '../types/chat';
import { protectedProcedure } from './trpc';

export const chatRoutes = {
	get: protectedProcedure.input(z.object({ chatId: z.string() })).query(async ({ input }): Promise<UIChat> => {
		const chat = await chatQueries.loadChat(input.chatId);
		if (!chat) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
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
