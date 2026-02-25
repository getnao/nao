import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as storyQueries from '../queries/story.queries';
import { protectedProcedure } from './trpc';

export const storyRoutes = {
	listAll: protectedProcedure.query(async ({ ctx }) => {
		return storyQueries.listUserStories(ctx.user.id);
	}),

	listVersions: protectedProcedure
		.input(z.object({ chatId: z.string(), storyId: z.string() }))
		.query(async ({ input, ctx }) => {
			await assertChatOwner(input.chatId, ctx.user.id);
			return storyQueries.listVersions(input.chatId, input.storyId);
		}),

	listStories: protectedProcedure.input(z.object({ chatId: z.string() })).query(async ({ input, ctx }) => {
		await assertChatOwner(input.chatId, ctx.user.id);
		return storyQueries.listStoriesInChat(input.chatId);
	}),

	createVersion: protectedProcedure
		.input(
			z.object({
				chatId: z.string(),
				storyId: z.string(),
				title: z.string().min(1),
				code: z.string().min(1),
				action: z.enum(['create', 'update', 'replace']),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await assertChatOwner(input.chatId, ctx.user.id);
			return storyQueries.createVersion({
				...input,
				source: 'user',
			});
		}),
};

async function assertChatOwner(chatId: string, userId: string): Promise<void> {
	const ownerId = await chatQueries.getChatOwnerId(chatId);
	if (ownerId !== userId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
	}
}
