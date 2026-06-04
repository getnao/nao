import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { DOWNLOAD_FORMATS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { STORY_REFRESH_JOB_NAME } from '../handlers/story-refresh.handler';
import * as activityQueries from '../queries/activity.queries';
import * as chatQueries from '../queries/chat.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { naturalLanguageToCron } from '../services/cron-nlp';
import { executeLiveQuery, getStoryQueryData, refreshStoryData } from '../services/live-story';
import { nextCronTick } from '../services/scheduler.service';
import { buildDownloadResponse } from '../utils/story-download';
import { extractStorySummary } from '../utils/story-summary';
import { canSendProcedure, ownedResourceProcedure, projectProtectedProcedure, protectedProcedure } from './trpc';

const chatOwnerProcedure = ownedResourceProcedure(chatQueries.getChatOwnerId, 'chat');
const storyOwnerProcedure = ownedResourceProcedure(storyQueries.getStoryOwnerId, 'story');

async function assertStoryPublicInProject(storyId: string, projectId: string): Promise<void> {
	const share = await sharedStoryQueries.getSharedStoryInfo(storyId, projectId);
	if (!share || share.visibility !== 'project') {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Only public stories can be archived by other members.',
		});
	}
}

export const storyRoutes = {
	listAll: protectedProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.query(async ({ input, ctx }) => {
			const stories = await storyQueries.listUserChatStories(ctx.user.id, { projectId: input?.projectId });
			const sharingByStoryId = await storyQueries.getStorySharingInfo(stories.map((s) => s.id));
			return stories.map(({ code, ...rest }) => ({
				...rest,
				storySlug: rest.slug,
				summary: extractStorySummary(code),
				sharing: sharingByStoryId.get(rest.id) ?? null,
			}));
		}),

	listArchived: protectedProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.query(async ({ input, ctx }) => {
			const stories = await storyQueries.listUserChatStories(ctx.user.id, {
				archived: true,
				projectId: input?.projectId,
			});
			const sharingByStoryId = await storyQueries.getStorySharingInfo(stories.map((s) => s.id));
			return stories.map(({ code, ...rest }) => ({
				...rest,
				storySlug: rest.slug,
				summary: extractStorySummary(code),
				sharing: sharingByStoryId.get(rest.id) ?? null,
			}));
		}),

	listStandalone: projectProtectedProcedure.query(async ({ ctx }) => {
		const stories = await storyQueries.listUserStandaloneStories(ctx.user.id, ctx.project.id);
		return stories.map(({ code, ...rest }) => ({
			...rest,
			storySlug: rest.slug,
			summary: extractStorySummary(code),
		}));
	}),

	listStandaloneArchived: projectProtectedProcedure.query(async ({ ctx }) => {
		const stories = await storyQueries.listUserStandaloneStories(ctx.user.id, ctx.project.id, { archived: true });
		return stories.map(({ code, ...rest }) => ({
			...rest,
			storySlug: rest.slug,
			summary: extractStorySummary(code),
		}));
	}),

	getStandalone: storyOwnerProcedure.input(z.object({ storyId: z.string() })).query(async ({ input, ctx }) => {
		const story = await storyQueries.getStoryByIdForUser(input.storyId, ctx.user.id);
		if (!story) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		const cache = await storyQueries.getStoryDataCacheByStoryId(input.storyId);
		return { ...story, queryData: cache?.queryData ?? null };
	}),

	getLatest: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input }) => {
			const version = await storyQueries.getLatestVersionByChatAndSlug(input.chatId, input.storySlug);
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

			const versions = await storyQueries.listStoryVersions(input.chatId, input.storySlug);
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
		.mutation(async ({ input, ctx }) => {
			const version = await storyQueries.createStoryVersion({
				chatId: input.chatId,
				slug: input.storySlug,
				title: input.title,
				code: input.code,
				action: input.action,
				source: 'user',
			});

			if (input.action === 'create') {
				const projectId = await chatQueries.getChatProjectId(input.chatId);
				if (projectId) {
					await storyFolderQueries.saveStoryInPrivateRoot(ctx.user.id, projectId, version.storyId);
				}
			}

			return version;
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
			assertValidRefreshSchedule(input.isLive, input.cacheSchedule);
			await storyQueries.updateStoryLiveSettings(input.chatId, input.storySlug, {
				isLive: input.isLive,
				isLiveTextDynamic: input.isLiveTextDynamic,
				cacheSchedule: input.cacheSchedule,
				cacheScheduleDescription: input.cacheScheduleDescription,
			});
			await syncStoryRefreshJob(input.chatId, input.storySlug, input.isLive, input.cacheSchedule);
		}),

	refreshData: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!story) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}
			const projectId = story.projectId ?? (await storyQueries.getStoryProjectId(story.id));
			if (!projectId) {
				throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Story has no project.' });
			}
			const activity = await activityQueries.startStoryRefreshActivity({
				projectId,
				userId: ctx.user.id,
				storyId: story.id,
				chatId: story.chatId,
				trigger: 'manual',
			});
			try {
				const { queryData } = await refreshStoryData(input.chatId, input.storySlug);
				await activityQueries.completeActivity(activity.id, {
					queriesRefreshed: Object.keys(queryData).length,
				});
				return { queryData, cachedAt: new Date() };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await activityQueries.failActivity(activity.id, message);
				throw err;
			}
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
			await syncStoryRefreshJob(input.chatId, input.storySlug, false, null);
		}),

	unarchive: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.mutation(async ({ input, ctx }) => {
			await storyQueries.unarchiveStory(input.chatId, input.storySlug);
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			const projectId = story ? await storyQueries.getStoryProjectId(story.id) : null;
			if (story && projectId) {
				await storyFolderQueries.rehomeUnarchivedStory(ctx.user.id, projectId, story.id);
			}
		}),

	archiveStandalone: storyOwnerProcedure.input(z.object({ storyId: z.string() })).mutation(async ({ input }) => {
		await storyQueries.archiveByStoryId(input.storyId);
		await unscheduleStoryRefreshJob(input.storyId);
	}),

	unarchiveStandalone: storyOwnerProcedure
		.input(z.object({ storyId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			await storyQueries.unarchiveByStoryId(input.storyId);
			const projectId = await storyQueries.getStoryProjectId(input.storyId);
			if (projectId) {
				await storyFolderQueries.rehomeUnarchivedStory(ctx.user.id, projectId, input.storyId);
			}
		}),

	listSharedArchived: projectProtectedProcedure.query(async ({ ctx }) => {
		const stories = await sharedStoryQueries.listProjectArchivedSharedStories(ctx.project.id);
		return stories.map((story) => ({
			...story,
			storySlug: story.slug,
			summary: extractStorySummary(story.code),
			sharing: {
				visibility: story.visibility,
				sharedWithCount: story.sharedWithCount,
				isPinned: story.isPinned,
			},
		}));
	}),

	archiveShared: canSendProcedure.input(z.object({ storyId: z.string() })).mutation(async ({ input, ctx }) => {
		await assertStoryPublicInProject(input.storyId, ctx.project.id);
		await storyQueries.archiveByStoryId(input.storyId);
		await unscheduleStoryRefreshJob(input.storyId);
	}),

	unarchiveShared: canSendProcedure.input(z.object({ storyId: z.string() })).mutation(async ({ input, ctx }) => {
		await assertStoryPublicInProject(input.storyId, ctx.project.id);
		await storyQueries.unarchiveByStoryId(input.storyId);
		await storyFolderQueries.rehomeUnarchivedStory(ctx.user.id, ctx.project.id, input.storyId);
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
			await storyQueries.archiveManyStories(input.stories.map((s) => ({ chatId: s.chatId, slug: s.storySlug })));
			await Promise.all(input.stories.map((s) => syncStoryRefreshJob(s.chatId, s.storySlug, false, null)));
		}),

	downloadStandalone: storyOwnerProcedure
		.input(z.object({ storyId: z.string(), format: z.enum(DOWNLOAD_FORMATS) }))
		.query(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByIdForUser(input.storyId, ctx.user.id);
			if (!story) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}
			const cache = await storyQueries.getStoryDataCacheByStoryId(input.storyId);
			return buildDownloadResponse(input.format, story.title, story.code, cache?.queryData ?? null);
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
				: await storyQueries.getLatestVersionByChatAndSlug(input.chatId, input.storySlug);
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

/**
 * Validates the refresh schedule before touching the database so an invalid
 * cron cannot be persisted on the story row.
 */
function assertValidRefreshSchedule(isLive: boolean, cacheSchedule: string | null): void {
	if (!isLive || cacheSchedule === null || cacheSchedule === NO_CACHE_SCHEDULE) {
		return;
	}
	if (!nextCronTick(cacheSchedule, new Date())) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid cron expression for refresh schedule: ${cacheSchedule}`,
		});
	}
}

/**
 * Idempotently aligns the scheduled job for a live story with its current cache
 * settings. Live stories with a real cron schedule get a recurring job; manual,
 * no-cache, or disabled stories have their job removed.
 */
async function syncStoryRefreshJob(
	chatId: string,
	storySlug: string,
	isLive: boolean,
	cacheSchedule: string | null,
): Promise<void> {
	const story = await storyQueries.getStoryByChatAndSlug(chatId, storySlug);
	if (!story) {
		return;
	}

	const shouldSchedule = isLive && cacheSchedule !== null && cacheSchedule !== NO_CACHE_SCHEDULE;

	if (!shouldSchedule) {
		if (story.scheduledJobId) {
			await scheduledJobQueries.deleteJob(story.scheduledJobId);
			await activityQueries.linkStoryScheduledJob(story.id, null);
		}
		return;
	}

	const runAt = nextCronTick(cacheSchedule!, new Date());
	if (!runAt) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `Invalid cron expression for refresh schedule: ${cacheSchedule}`,
		});
	}

	const job = await scheduledJobQueries.upsertRecurringJob({
		name: STORY_REFRESH_JOB_NAME,
		cron: cacheSchedule!,
		uniqueKey: activityQueries.storyRefreshJobUniqueKey(story.id),
		payload: { storyId: story.id },
		runAt,
		status: 'pending',
		resetRunAtOnConflict: true,
	});
	await activityQueries.linkStoryScheduledJob(story.id, job.id);
}

async function unscheduleStoryRefreshJob(storyId: string): Promise<void> {
	const story = await storyQueries.getStoryById(storyId);
	if (!story?.scheduledJobId) {
		return;
	}
	await scheduledJobQueries.deleteJob(story.scheduledJobId);
	await activityQueries.linkStoryScheduledJob(storyId, null);
}
