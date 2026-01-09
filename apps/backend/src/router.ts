import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { publicProcedure, router } from './trpc';
import { type Chat, type ChatListItem } from './types/chat';
import { chatStorage } from './utils/chatStorage';

export const trpcRouter = router({
	getChat: publicProcedure.input(z.object({ chatId: z.string() })).query(async ({ input }): Promise<Chat> => {
		const chat = await chatStorage.getChat(input.chatId);
		if (!chat) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
		}
		return chat;
	}),

	hasGoogleSetup: publicProcedure.query(() => {
		return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
	}),

	listChats: publicProcedure.query(async (): Promise<ChatListItem[]> => {
		return chatStorage.listChats();
	}),

	deleteChat: publicProcedure.input(z.object({ chatId: z.string() })).mutation(async ({ input }): Promise<void> => {
		await chatStorage.deleteChat(input.chatId);
	}),
});

export type TrpcRouter = typeof trpcRouter;
