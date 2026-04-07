import { DOWNLOAD_FORMATS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as storyQueries from '../queries/story.queries';
import { naturalLanguageToCron } from '../services/cron-nlp';
import { executeLiveQuery, getStoryQueryData, refreshStoryData } from '../services/live-story';
import { buildDownloadResponse } from '../utils/story-download';
import { extractStorySummary } from '../utils/story-summary';
import { ownedResourceProcedure, projectProtectedProcedure, protectedProcedure } from './trpc';

const chatOwnerProcedure = ownedResourceProcedure(chatQueries.getChatOwnerId, 'chat');

export const storyRoutes = {
	listAll: protectedProcedure.query(async ({ ctx }) => {
		const stories = await storyQueries.listUserStories(ctx.user.id);
		return stories.map(({ code, ...rest }) => ({
			...rest,
			storySlug: rest.slug,
			summary: extractStorySummary(code),
		}));
	}),

	listArchived: protectedProcedure.query(async ({ ctx }) => {
		const stories = await storyQueries.listUserStories(ctx.user.id, { archived: true });
		return stories.map(({ code, ...rest }) => ({
			...rest,
			storySlug: rest.slug,
			summary: extractStorySummary(code),
		}));
	}),

	getLatest: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input }) => {
			const version = await storyQueries.getLatestVersion(input.chatId, input.storySlug);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}
			const { queryData, cachedAt } = await getStoryQueryData(
				input.chatId,
				input.storySlug,
				version.code,
				version.isLive,
				version.cacheSchedule,
			);
			return { ...version, queryData, cachedAt };
		}),

	listVersions: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input }) => {
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!story) {
				return {
					title: input.storySlug,
					isLive: false,
					isLiveTextDynamic: false,
					cacheSchedule: null as string | null,
					cacheScheduleDescription: null as string | null,
					archivedAt: null as Date | null,
					versions: [],
				};
			}

			const versions = await storyQueries.listVersions(input.chatId, input.storySlug);
			return {
				title: story.title,
				isLive: story.isLive,
				isLiveTextDynamic: story.isLiveTextDynamic,
				cacheSchedule: story.cacheSchedule,
				cacheScheduleDescription: story.cacheScheduleDescription,
				archivedAt: story.archivedAt,
				versions,
			};
		}),

	listStories: chatOwnerProcedure.input(z.object({ chatId: z.string() })).query(async ({ input }) => {
		const stories = await storyQueries.listStoriesInChat(input.chatId);
		return stories.map((s) => ({ storySlug: s.slug, title: s.title, latestVersion: s.latestVersion }));
	}),

	createVersion: chatOwnerProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				title: z.string().min(1),
				code: z.string().min(1),
				action: z.enum(['create', 'update', 'replace']),
			}),
		)
		.mutation(async ({ input }) => {
			return storyQueries.createVersion({
				chatId: input.chatId,
				slug: input.storySlug,
				title: input.title,
				code: input.code,
				action: input.action,
				source: 'user',
			});
		}),

	updateLiveSettings: chatOwnerProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				isLive: z.boolean(),
				isLiveTextDynamic: z.boolean(),
				cacheSchedule: z.string().nullable(),
				cacheScheduleDescription: z.string().nullable(),
			}),
		)
		.mutation(async ({ input }) => {
			await storyQueries.updateLiveSettings(input.chatId, input.storySlug, {
				isLive: input.isLive,
				isLiveTextDynamic: input.isLiveTextDynamic,
				cacheSchedule: input.cacheSchedule,
				cacheScheduleDescription: input.cacheScheduleDescription,
			});
		}),

	refreshData: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.mutation(async ({ input }) => {
			const { queryData } = await refreshStoryData(input.chatId, input.storySlug);
			return { queryData, cachedAt: new Date() };
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
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.mutation(async ({ input }) => {
			await storyQueries.archiveStory(input.chatId, input.storySlug);
		}),

	unarchive: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.mutation(async ({ input }) => {
			await storyQueries.unarchiveStory(input.chatId, input.storySlug);
		}),

	archiveMany: protectedProcedure
		.input(z.object({ stories: z.array(z.object({ chatId: z.string(), storySlug: z.string() })).min(1) }))
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
			await storyQueries.archiveMany(input.stories.map((s) => ({ chatId: s.chatId, slug: s.storySlug })));
		}),

	download: chatOwnerProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				format: z.enum(DOWNLOAD_FORMATS),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input }) => {
			const version = input.versionNumber
				? await storyQueries.getVersionByNumber(input.chatId, input.storySlug, input.versionNumber)
				: await storyQueries.getLatestVersion(input.chatId, input.storySlug);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

			const { queryData } = await getStoryQueryData(
				input.chatId,
				input.storySlug,
				version.code,
				version.isLive,
				version.cacheSchedule,
			);

			return buildDownloadResponse(input.format, version.title, version.code, queryData);
		}),
};
