import { BULK_ITEMS_LIMIT, NO_CACHE_SCHEDULE } from '@nao/shared';
import type { BulkStoryItem, UserRole } from '@nao/shared/types';
import { DOWNLOAD_FORMATS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { STORY_REFRESH_JOB_NAME } from '../handlers/story-refresh.handler';
import * as activityQueries from '../queries/activity.queries';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { naturalLanguageToCron } from '../services/cron-nlp';
import { executeLiveQuery, getStoryQueryData, refreshStoryData } from '../services/live-story';
import { nextCronTick } from '../services/scheduler.service';
import {
	assertStoryFiltersEnabled,
	getFilteredStoryQueryData,
	getStoryFilterOptions,
	getStoryQuerySql,
} from '../services/story-filters';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { buildDownloadResponse } from '../utils/story-download';
import { backfillMissingQueryData } from '../utils/story-query-data';
import { extractStorySummary } from '../utils/story-summary';
import { canSendProcedure, ownedResourceProcedure, projectProtectedProcedure, protectedProcedure } from './trpc';
import { assertUserGroupFeatureForTrpc } from './user-group-feature-access';

const chatOwnerProcedure = ownedResourceProcedure(chatQueries.getChatOwnerId, 'chat');
const storyOwnerProcedure = ownedResourceProcedure(storyQueries.getStoryOwnerId, 'story');
const chatStoryProcedure = chatOwnerProcedure.use(async ({ ctx, getRawInput, next }) => {
	const input = (await getRawInput()) as { chatId: string };
	const projectId = await chatQueries.getChatProjectId(input.chatId);
	if (!projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
	}
	if (!(await projectQueries.getUserRoleInProject(projectId, ctx.user.id))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
	}
	return next();
});
const storyOwnerProjectProcedure = storyOwnerProcedure.use(async ({ ctx, getRawInput, next }) => {
	const input = (await getRawInput()) as { storyId: string };
	const projectId = await storyQueries.getStoryProjectId(input.storyId);
	if (!projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	if (!(await projectQueries.getUserRoleInProject(projectId, ctx.user.id))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
	}
	return next();
});

const bulkStoryItemsInput = z.object({
	items: z
		.array(
			z.discriminatedUnion('kind', [
				z.object({ kind: z.literal('own'), storyId: z.string() }),
				z.object({ kind: z.literal('shared-project'), storyId: z.string() }),
			]),
		)
		.min(1)
		.max(BULK_ITEMS_LIMIT),
});

async function assertCanArchiveSharedStory(
	storyId: string,
	ctx: { user: { id: string }; userRole: UserRole | null; project: { id: string } },
): Promise<void> {
	const ownerId = await storyQueries.getStoryOwnerId(storyId);
	if (!ownerId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	const storyProjectId = await storyQueries.getStoryProjectId(storyId);
	if (storyProjectId !== ctx.project.id) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	if (ownerId !== ctx.user.id && ctx.userRole !== 'admin') {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Only the owner or an admin can archive this story.',
		});
	}
}

export const storyRoutes = {
	listAll: protectedProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.query(async ({ input, ctx }) => {
			const stories = await storyQueries.listUserChatStories(ctx.user.id, { projectId: input?.projectId });
			const visibleStories = await filterStoriesByProjectAccess(stories, ctx.user.id, input?.projectId);
			const sharingByStoryId = await storyQueries.getStorySharingInfo(visibleStories.map((s) => s.id));
			return visibleStories.map(({ code, ...rest }) => ({
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
			const visibleStories = await filterStoriesByProjectAccess(stories, ctx.user.id, input?.projectId);
			const sharingByStoryId = await storyQueries.getStorySharingInfo(visibleStories.map((s) => s.id));
			return visibleStories.map(({ code, ...rest }) => ({
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

	getStandalone: storyOwnerProjectProcedure.input(z.object({ storyId: z.string() })).query(async ({ input, ctx }) => {
		const story = await storyQueries.getStoryByIdForUser(input.storyId, ctx.user.id);
		if (!story) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		const [cache, lastRefreshFailure] = await Promise.all([
			storyQueries.getStoryDataCacheByStoryId(input.storyId),
			activityQueries.getLatestStoryRefreshFailure(input.storyId),
		]);

		if (story.projectId) {
			logAnalyticsEvent({
				projectId: story.projectId,
				type: 'page_view',
				assetType: 'story',
				actorUserId: ctx.user.id,
				storyId: input.storyId,
				metadata: { type: 'page_view', versionNumber: story.version },
			});
		}

		const liveData =
			story.chatId && story.isLive
				? await getStoryQueryData(story.chatId, story.slug, story.code, true, story.cacheSchedule, ctx.user.id)
				: null;
		const queryData = liveData
			? liveData.queryData
			: story.chatId
				? await backfillMissingQueryData(story.code, cache?.queryData ?? null, { chatId: story.chatId })
				: (cache?.queryData ?? null);

		return { ...story, queryData, cachedAt: liveData?.cachedAt ?? cache?.cachedAt ?? null, lastRefreshFailure };
	}),

	getLatest: chatStoryProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input, ctx }) => {
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
				ctx.user.id,
			);
			const lastRefreshFailure = await activityQueries.getLatestStoryRefreshFailure(version.storyId);

			const projectId = await chatQueries.getChatProjectId(input.chatId);
			if (projectId) {
				logAnalyticsEvent({
					projectId,
					type: 'page_view',
					assetType: 'story',
					actorUserId: ctx.user.id,
					storyId: version.storyId,
					chatId: input.chatId,
					metadata: { type: 'page_view', versionNumber: version.version },
				});
			}

			return { ...version, queryData, cachedAt, lastRefreshFailure };
		}),

	listVersions: chatStoryProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input }) => {
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!story) {
				return {
					id: null as string | null,
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
				id: story.id as string | null,
				title: story.title,
				isLive: story.isLive,
				isLiveTextDynamic: story.isLiveTextDynamic,
				cacheSchedule: story.cacheSchedule,
				cacheScheduleDescription: story.cacheScheduleDescription,
				archivedAt: story.archivedAt,
				versions,
			};
		}),

	getVersionQueryData: chatStoryProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				versionNumber: z.number().int().positive(),
			}),
		)
		.query(async ({ input }) => {
			const version = await storyQueries.getVersionByNumber(input.chatId, input.storySlug, input.versionNumber);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story version not found.' });
			}

			const queryData = await sharedStoryQueries.getQueryDataFromCode(input.chatId, version.code);
			return { queryData };
		}),

	listStories: chatStoryProcedure.input(z.object({ chatId: z.string() })).query(async ({ input }) => {
		const stories = await storyQueries.listStoriesInChat(input.chatId);
		return stories.map((s) => ({ storySlug: s.slug, title: s.title, latestVersion: s.latestVersion }));
	}),

	rename: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string(), title: z.string().trim().min(1).max(255) }))
		.mutation(async ({ input }) => {
			await storyQueries.renameStory(input.storyId, input.title);
		}),

	createVersion: chatStoryProcedure
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
			const existingStory = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!existingStory) {
				const projectId = await chatQueries.getChatProjectId(input.chatId);
				if (!projectId) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
				}
				await assertUserGroupFeatureForTrpc(projectId, ctx.user.id, 'story-creation');
			}
			const version = await storyQueries.createStoryVersion({
				chatId: input.chatId,
				slug: input.storySlug,
				title: input.title,
				code: input.code,
				action: input.action,
				source: 'user',
			});

			if (!existingStory) {
				const projectId = await chatQueries.getChatProjectId(input.chatId);
				if (projectId) {
					await storyFolderQueries.saveStoryInPrivateRoot(ctx.user.id, projectId, version.storyId);
				}
			}

			return version;
		}),

	updateLiveSettings: chatStoryProcedure
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

	refreshData: chatStoryProcedure
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
				const { queryData } = await refreshStoryData(input.chatId, input.storySlug, ctx.user.id);
				await activityQueries.completeActivity(activity.id, {
					queriesRefreshed: Object.keys(queryData).length,
				});
				logAnalyticsEvent({
					projectId,
					type: 'refresh',
					assetType: 'story',
					actorUserId: ctx.user.id,
					storyId: story.id,
					chatId: story.chatId,
					metadata: { type: 'refresh', trigger: 'manual', queriesRefreshed: Object.keys(queryData).length },
				});
				return { queryData, cachedAt: new Date() };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await activityQueries.failActivity(activity.id, message);
				throw err;
			}
		}),

	getLiveQueryData: chatStoryProcedure
		.input(z.object({ chatId: z.string(), queryId: z.string() }))
		.query(async ({ input, ctx }) => {
			return executeLiveQuery(input.chatId, input.queryId, ctx.user.id);
		}),

	getFilterOptions: chatStoryProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string(), filterId: z.string() }))
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			return getStoryFilterOptions(input.chatId, input.storySlug, input.filterId, ctx.user.id);
		}),

	getFilteredQueryData: chatStoryProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				selections: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
			}),
		)
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			return getFilteredStoryQueryData(input.chatId, input.storySlug, input.selections, ctx.user.id);
		}),

	getQuerySql: chatStoryProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				queryId: z.string(),
				selections: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
			}),
		)
		.query(async ({ input }) => {
			return getStoryQuerySql(input.chatId, input.storySlug, input.queryId, input.selections);
		}),

	parseCronFromText: projectProtectedProcedure
		.input(z.object({ text: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			const cron = await naturalLanguageToCron(ctx.project.id, input.text);
			return { cron };
		}),

	archive: chatStoryProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.mutation(async ({ input }) => {
			await storyQueries.archiveStory(input.chatId, input.storySlug);
			await syncStoryRefreshJob(input.chatId, input.storySlug, false, null);
		}),

	unarchive: chatStoryProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.mutation(async ({ input, ctx }) => {
			await storyQueries.unarchiveStory(input.chatId, input.storySlug);
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			const projectId = story ? await storyQueries.getStoryProjectId(story.id) : null;
			if (story && projectId) {
				await storyFolderQueries.rehomeUnarchivedStory(ctx.user.id, projectId, story.id);
			}
		}),

	archiveStandalone: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string() }))
		.mutation(async ({ input }) => {
			await storyQueries.archiveByStoryId(input.storyId);
			await unscheduleStoryRefreshJob(input.storyId);
		}),

	unarchiveStandalone: storyOwnerProjectProcedure
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
		await assertCanArchiveSharedStory(input.storyId, ctx);
		await storyQueries.archiveByStoryId(input.storyId);
		await unscheduleStoryRefreshJob(input.storyId);
	}),

	unarchiveShared: canSendProcedure.input(z.object({ storyId: z.string() })).mutation(async ({ input, ctx }) => {
		await assertCanArchiveSharedStory(input.storyId, ctx);
		await storyQueries.unarchiveByStoryId(input.storyId);
		await storyFolderQueries.rehomeUnarchivedStory(ctx.user.id, ctx.project.id, input.storyId);
	}),

	bulkArchive: canSendProcedure.input(bulkStoryItemsInput).mutation(async ({ input, ctx }) => {
		await assertBulkItemsOwnership(input.items, ctx.user.id, ctx, 'archive');
		await Promise.all(
			input.items.map(async (item) => {
				await storyQueries.archiveByStoryId(item.storyId);
				await unscheduleStoryRefreshJob(item.storyId);
			}),
		);
	}),

	bulkUnarchive: canSendProcedure.input(bulkStoryItemsInput).mutation(async ({ input, ctx }) => {
		await assertBulkItemsOwnership(input.items, ctx.user.id, ctx, 'unarchive');
		await Promise.all(
			input.items.map(async (item) => {
				await storyQueries.unarchiveByStoryId(item.storyId);
				const projectId = await storyQueries.getStoryProjectId(item.storyId);
				if (projectId) {
					await storyFolderQueries.rehomeUnarchivedStory(ctx.user.id, projectId, item.storyId);
				}
			}),
		);
	}),

	downloadStandalone: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string(), format: z.enum(DOWNLOAD_FORMATS) }))
		.query(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByIdForUser(input.storyId, ctx.user.id);
			if (!story) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}
			const cache = await storyQueries.getStoryDataCacheByStoryId(input.storyId);

			if (story.projectId) {
				logAnalyticsEvent({
					projectId: story.projectId,
					type: 'download',
					assetType: 'story',
					actorUserId: ctx.user.id,
					storyId: input.storyId,
					metadata: {
						type: 'download',
						format: input.format,
						versionNumber: story.version,
						title: story.title,
					},
				});
			}

			const liveData =
				story.chatId && story.isLive
					? await getStoryQueryData(
							story.chatId,
							story.slug,
							story.code,
							true,
							story.cacheSchedule,
							ctx.user.id,
						)
					: null;
			const displaySettings = story.projectId ? await projectQueries.getDisplaySettings(story.projectId) : null;
			return buildDownloadResponse(
				input.format,
				story.title,
				story.code,
				liveData?.queryData ?? cache?.queryData ?? null,
				displaySettings?.dateFormat,
			);
		}),

	download: chatStoryProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				format: z.enum(DOWNLOAD_FORMATS),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
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
				ctx.user.id,
			);

			const projectId = await chatQueries.getChatProjectId(input.chatId);
			if (projectId) {
				logAnalyticsEvent({
					projectId,
					type: 'download',
					assetType: 'story',
					actorUserId: ctx.user.id,
					storyId: version.storyId,
					chatId: input.chatId,
					metadata: {
						type: 'download',
						format: input.format,
						versionNumber: version.version,
						title: version.title,
					},
				});
			}

			const displaySettings = projectId ? await projectQueries.getDisplaySettings(projectId) : null;

			return buildDownloadResponse(
				input.format,
				version.title,
				version.code,
				queryData,
				displaySettings?.dateFormat,
			);
		}),
};

async function filterStoriesByProjectAccess(
	stories: Awaited<ReturnType<typeof storyQueries.listUserChatStories>>,
	userId: string,
	explicitProjectId?: string,
) {
	if (explicitProjectId) {
		const userRole = await projectQueries.getUserRoleInProject(explicitProjectId, userId);
		if (!userRole) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
		}
		return stories;
	}

	const projectIds = [
		...new Set(
			stories.map((story) => story.projectId).filter((projectId): projectId is string => projectId !== null),
		),
	];
	const projectAccess = await Promise.all(
		projectIds.map(async (projectId) => ({
			projectId,
			hasAccess: Boolean(await projectQueries.getUserRoleInProject(projectId, userId)),
		})),
	);
	const accessibleProjectIds = new Set(
		projectAccess.filter(({ hasAccess }) => hasAccess).map(({ projectId }) => projectId),
	);
	return stories.filter((story) => story.projectId !== null && accessibleProjectIds.has(story.projectId));
}

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

async function assertBulkItemsOwnership(
	items: BulkStoryItem[],
	userId: string,
	ctx: { user: { id: string }; userRole: UserRole | null; project: { id: string } },
	action: 'archive' | 'unarchive',
): Promise<void> {
	const ownedIds = items.filter((i) => i.kind === 'own').map((i) => i.storyId);
	const sharedIds = items.filter((i) => i.kind === 'shared-project').map((i) => i.storyId);

	await Promise.all([
		...ownedIds.map(async (storyId) => {
			const story = await storyQueries.getStoryByIdForUser(storyId, userId);
			if (!story || story.projectId !== ctx.project.id) {
				throw new TRPCError({ code: 'FORBIDDEN', message: `You can only ${action} your own stories.` });
			}
		}),
		...sharedIds.map(async (storyId) => {
			await assertCanArchiveSharedStory(storyId, ctx);
		}),
	]);
}
