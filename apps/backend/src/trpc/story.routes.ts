import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as storyQueries from '../queries/story.queries';
import { naturalLanguageToCron } from '../services/cron-nlp';
import { executeLiveQuery, getStoryQueryData, refreshStoryData } from '../services/live-story';
import { extractStorySummary } from '../utils/story-summary';
import { ownedResourceProcedure, projectProtectedProcedure, protectedProcedure } from './trpc';

const chatOwnerProcedure = ownedResourceProcedure(chatQueries.getChatOwnerId, 'chat');

export const storyRoutes = {
	listAll: protectedProcedure.query(async ({ ctx }) => {
		const stories = await storyQueries.listUserStories(ctx.user.id);
		return stories.map(({ code, ...rest }) => ({
			...rest,
			summary: extractStorySummary(code),
		}));
	}),

	listArchived: protectedProcedure.query(async ({ ctx }) => {
		const stories = await storyQueries.listUserStories(ctx.user.id, { archived: true });
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
			const { queryData, regeneratedCode, cachedAt } = await getStoryQueryData(
				input.chatId,
				input.storyId,
				version.code,
				version.isLive,
				version.cacheSchedule,
			);
			return { ...version, queryData, regeneratedCode, cachedAt };
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

	updateLiveSettings: chatOwnerProcedure
		.input(
			z.object({
				chatId: z.string(),
				storyId: z.string(),
				isLive: z.boolean(),
				cacheSchedule: z.string().nullable(),
				refreshText: z.boolean(),
			}),
		)
		.mutation(async ({ input }) => {
			await storyQueries.updateLiveSettings(input.chatId, input.storyId, {
				isLive: input.isLive,
				cacheSchedule: input.cacheSchedule,
				refreshText: input.refreshText,
			});
		}),

	refreshData: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storyId: z.string() }))
		.mutation(async ({ input }) => {
			const { queryData, regeneratedCode } = await refreshStoryData(input.chatId, input.storyId);
			return { queryData, regeneratedCode, cachedAt: new Date() };
		}),

	getLiveQueryData: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), queryId: z.string() }))
		.query(async ({ input }) => {
			return executeLiveQuery(input.chatId, input.queryId);
		}),

	parseCronFromText: projectProtectedProcedure
		.input(z.object({ text: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			const cron = await naturalLanguageToCron(ctx.project.id, input.text);
			return { cron };
		}),

	archive: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storyId: z.string() }))
		.mutation(async ({ input }) => {
			await storyQueries.archiveStory(input.chatId, input.storyId);
		}),

	unarchive: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storyId: z.string() }))
		.mutation(async ({ input }) => {
			await storyQueries.unarchiveStory(input.chatId, input.storyId);
		}),

	archiveMany: protectedProcedure
		.input(z.object({ stories: z.array(z.object({ chatId: z.string(), storyId: z.string() })).min(1) }))
		.mutation(async ({ input, ctx }) => {
			const chatIds = [...new Set(input.stories.map((s) => s.chatId))];
			await Promise.all(
				chatIds.map(async (chatId) => {
					const ownerId = await chatQueries.getChatOwnerId(chatId);
					if (ownerId !== ctx.user.id) {
						throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only archive your own stories.' });
					}
				}),
			);
			await storyQueries.archiveMany(input.stories);
		}),
};
