import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import { extractStorySummary } from '../utils/story-summary';
import { ownedResourceProcedure, protectedProcedure } from './trpc';

const chatOwnerProcedure = ownedResourceProcedure(chatQueries.getChatOwnerId, 'chat');

export const storyRoutes = {
	listAll: protectedProcedure.query(async ({ ctx }) => {
		const stories = await storyQueries.listUserStories(ctx.user.id);
		return stories.map(({ code, ...rest }) => ({
			...rest,
			summary: extractStorySummary(code),
		}));
	}),

	getLatest: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storyId: z.string() }))
		.query(async ({ input }) => {
			const version = await storyQueries.getLatestVersion(input.chatId, input.storyId);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}
			const queryData = await sharedStoryQueries.collectQueryData(input.chatId, version.code);
			return { ...version, queryData };
		}),

	listVersions: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storyId: z.string() }))
		.query(async ({ input }) => {
			return storyQueries.listVersions(input.chatId, input.storyId);
		}),

	listStories: chatOwnerProcedure.input(z.object({ chatId: z.string() })).query(async ({ input }) => {
		return storyQueries.listStoriesInChat(input.chatId);
	}),

	createVersion: chatOwnerProcedure
		.input(
			z.object({
				chatId: z.string(),
				storyId: z.string(),
				title: z.string().min(1),
				code: z.string().min(1),
				action: z.enum(['create', 'update', 'replace']),
			}),
		)
		.mutation(async ({ input }) => {
			return storyQueries.createVersion({
				...input,
				source: 'user',
			});
		}),
};
