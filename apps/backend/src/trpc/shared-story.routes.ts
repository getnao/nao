import { DOWNLOAD_FORMATS, SHARE_VISIBILITY, type UserRole } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as activityQueries from '../queries/activity.queries';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { logActivity } from '../services/activity';
import {
	getCustomStoryNarratives,
	getCustomStoryVersion,
	getSharedCustomStoryQueryData,
	getSharedCustomStoryQuerySql,
} from '../services/custom-story';
import { executeLiveQuery, getStoryQueryData, refreshStoryData } from '../services/live-story';
import { notifySharedItem } from '../services/notification.service';
import {
	assertShareableUserGroupIds,
	filterShareableUserGroupIds,
	listShareableUserGroups,
} from '../services/shareable-user-groups.service';
import { teardownStoryDelivery } from '../services/story-delivery.service';
import {
	assertStoryFiltersEnabled,
	getFilteredStoryQueryData,
	getStoryFilterOptions,
	getStoryQuerySql,
} from '../services/story-filters';
import { hasUserGroupFeature } from '../services/user-group-feature-access.service';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { storySnapshotHtml, toCustomStoryQueryTrpcError, toCustomStoryTrpcError } from '../utils/custom-story-trpc';
import { withKeyedLock } from '../utils/keyed-lock';
import { buildDownloadResponse } from '../utils/story-download';
import { buildStorySnapshotDownload } from '../utils/story-snapshot';
import { extractStorySummary } from '../utils/story-summary';
import {
	adminProtectedProcedure,
	canSendProcedure,
	projectProtectedProcedure,
	protectedProcedure,
	resourceProjectProcedure,
} from './trpc';

const chatProcedure = resourceProjectProcedure('chatId', chatQueries.getChatInfo, 'Chat');
const shareProcedure = resourceProjectProcedure('shareId', sharedStoryQueries.getSharedStory, 'Shared story');
const shareAccessProcedure = resourceProjectProcedure(
	'shareId',
	sharedStoryQueries.getSharedStory,
	'Shared story',
	async (item, userId) =>
		item.visibility !== 'specific' ||
		item.userId === userId ||
		sharedStoryQueries.canUserAccessSharedStory(item.id, userId),
);
export const sharedStoryRoutes = {
	list: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ input, ctx }) => {
		const projects = await projectQueries.listUserProjects(ctx.user.id);
		const projectIds = projects.map((p) => p.id);
		const stories = await sharedStoryQueries.listUserSharedStories(projectIds, ctx.user.id, input.projectId);
		return stories.map((story) => ({
			...story,
			storySlug: story.slug,
			summary: extractStorySummary(story.code),
			sharing: {
				visibility: story.visibility,
				sharedWithCount: story.sharedWithCount,
				sharedWithGroupCount: story.sharedWithGroupCount,
				isPinned: story.isPinned,
			},
		}));
	}),

	create: canSendProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				visibility: z.enum(SHARE_VISIBILITY).default('project'),
				allowedUserIds: z.array(z.string()).optional(),
				allowedGroupIds: z.array(z.string()).optional(),
				pinAfterCreate: z.boolean().optional(),
				notify: z.boolean().default(false),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			if (input.pinAfterCreate && ctx.userRole !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can pin stories.' });
			}

			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!story) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

			const storyProjectId = story.projectId ?? (await storyQueries.getStoryProjectId(story.id));
			if (storyProjectId !== ctx.project.id) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found in this project.' });
			}

			const storyOwnerId = (await storyQueries.getStoryOwnerId(story.id)) ?? ctx.user.id;
			if (storyOwnerId !== ctx.user.id && ctx.userRole !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can share this.' });
			}

			await assertShareableUserGroupIds(ctx.project.id, input.allowedGroupIds ?? []);

			if (input.visibility === 'project') {
				await storyFolderQueries.moveStoryToFolder(story.id, null, {
					storyOwnerId,
					projectId: ctx.project.id,
				});
			} else {
				await storyFolderQueries.ensureStoryPrivate(story.id, {
					storyOwnerId,
					projectId: ctx.project.id,
				});
			}

			const created = await sharedStoryQueries.createSharedStory(
				{
					storyId: story.id,
					projectId: ctx.project.id,
					userId: ctx.user.id,
					visibility: input.visibility,
				},
				{ userIds: input.allowedUserIds, groupIds: input.allowedGroupIds },
				{ pinned: input.pinAfterCreate === true },
			);

			await logActivity({
				projectId: ctx.project.id,
				userId: ctx.user.id,
				type: 'story.shared',
				storyId: story.id,
				sharedStoryId: created.id,
			});

			const recipientUserIds =
				input.visibility === 'specific'
					? await sharedStoryQueries.getSharedStoryRecipientUserIds(created.id)
					: undefined;
			notifySharedItem({
				projectId: ctx.project.id,
				sharerId: ctx.user.id,
				sharerName: ctx.user.name,
				shareId: created.id,
				itemLabel: 'story',
				itemTitle: story.title,
				visibility: input.visibility,
				allowedUserIds: recipientUserIds,
				deliverExternally: input.notify,
			}).catch((err) => console.error('Failed to notify shared story recipients', err));

			return created;
		}),

	get: shareAccessProcedure.input(z.object({ shareId: z.string() })).query(async ({ ctx }) => {
		const shared = ctx.resource;
		const storyRow = await storyQueries.getStoryByChatAndSlug(shared.chatId!, shared.slug);
		const isLive = storyRow?.isLive ?? false;
		const isLiveTextDynamic = storyRow?.isLiveTextDynamic ?? false;
		const cacheSchedule = storyRow?.cacheSchedule ?? null;
		const cacheScheduleDescription = storyRow?.cacheScheduleDescription ?? null;
		const { canRefresh } = await getStoryRefreshAccess(shared.storyId, ctx.user.id, ctx.userRole);
		const canFork = await getStoryForkAccess(shared, ctx.user.id, ctx.userRole);

		const { queryData, cachedAt, code } = await getStoryQueryData(
			shared.chatId!,
			shared.slug,
			shared.code,
			isLive,
			cacheSchedule,
		);
		const lastRefreshFailure = await activityQueries.getLatestStoryRefreshFailure(shared.storyId);

		if (ctx.user.id !== shared.userId) {
			logAnalyticsEvent({
				projectId: shared.projectId,
				type: 'page_view',
				assetType: 'story',
				actorUserId: ctx.user.id,
				storyId: shared.storyId,
				chatId: shared.chatId,
				sharedStoryId: shared.id,
			});
		}

		return {
			...shared,
			code,
			storyId: shared.storyId,
			queryData,
			isLive,
			isLiveTextDynamic,
			cacheSchedule,
			cacheScheduleDescription,
			cachedAt,
			lastRefreshFailure,
			userRole: ctx.userRole,
			canRefresh,
			canFork,
		};
	}),

	getCustomVersion: shareAccessProcedure
		.input(z.object({ shareId: z.string(), versionNumber: z.number().int().positive().optional() }))
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			try {
				return await getCustomStoryVersion(shared.chatId!, shared.slug, input.versionNumber);
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	getCustomStoryQuerySql: shareAccessProcedure
		.input(
			z.object({
				shareId: z.string(),
				queryId: z.string(),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			try {
				const sqlQuery = await getSharedCustomStoryQuerySql(
					shared.chatId!,
					shared.slug,
					input.queryId,
					input.versionNumber,
				);
				return { sqlQuery };
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	getCustomStoryQueryData: shareAccessProcedure
		.input(
			z.object({
				shareId: z.string(),
				queryId: z.string(),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			try {
				return await getSharedCustomStoryQueryData(
					shared.chatId!,
					shared.slug,
					input.queryId,
					input.versionNumber,
				);
			} catch (error) {
				throw toCustomStoryQueryTrpcError(error);
			}
		}),

	getCustomStoryNarratives: shareAccessProcedure.input(z.object({ shareId: z.string() })).query(async ({ ctx }) => {
		const shared = ctx.resource;
		try {
			return await getCustomStoryNarratives(shared.chatId!, shared.slug);
		} catch (error) {
			throw toCustomStoryTrpcError(error);
		}
	}),

	downloadCustom: shareAccessProcedure
		.input(z.object({ shareId: z.string(), format: z.enum(DOWNLOAD_FORMATS), html: storySnapshotHtml }))
		.mutation(async ({ input, ctx }) => {
			const shared = ctx.resource;
			if (shared.format !== 'custom') {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

			logAnalyticsEvent({
				projectId: shared.projectId,
				type: 'download',
				assetType: 'story',
				actorUserId: ctx.user.id,
				storyId: shared.storyId,
				chatId: shared.chatId,
				sharedStoryId: shared.id,
				metadata: {
					type: 'download',
					format: input.format,
					versionNumber: shared.version,
					title: shared.title,
				},
			});

			return buildStorySnapshotDownload(input.format, shared.title, input.html);
		}),

	getVersionQueryData: shareAccessProcedure
		.input(z.object({ shareId: z.string(), versionNumber: z.number().int().positive() }))
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			if (!shared.chatId) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Shared story has no chat.' });
			}

			const version = await storyQueries.getVersionByNumber(shared.chatId, shared.slug, input.versionNumber);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story version not found.' });
			}

			const queryData = await sharedStoryQueries.getQueryDataFromCode(shared.chatId, version.code);
			return { queryData };
		}),

	getLiveQueryData: chatProcedure
		.input(z.object({ chatId: z.string(), queryId: z.string() }))
		.query(async ({ input }) => {
			return executeLiveQuery(input.chatId, input.queryId);
		}),

	getFilterOptions: shareAccessProcedure
		.input(z.object({ shareId: z.string(), filterId: z.string() }))
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			const shared = ctx.resource;
			if (!shared.chatId) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Shared story has no chat.' });
			}
			return getStoryFilterOptions(shared.chatId, shared.slug, input.filterId);
		}),

	getFilteredQueryData: shareAccessProcedure
		.input(
			z.object({
				shareId: z.string(),
				selections: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
			}),
		)
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			const shared = ctx.resource;
			if (!shared.chatId) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Shared story has no chat.' });
			}
			return getFilteredStoryQueryData(shared.chatId, shared.slug, input.selections);
		}),

	getQuerySql: shareAccessProcedure
		.input(
			z.object({
				shareId: z.string(),
				queryId: z.string(),
				selections: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
			}),
		)
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			if (!shared.chatId) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Shared story has no chat.' });
			}
			return getStoryQuerySql(shared.chatId, shared.slug, input.queryId, input.selections);
		}),

	refreshData: shareAccessProcedure.input(z.object({ shareId: z.string() })).mutation(async ({ ctx }) => {
		const shared = ctx.resource;
		if (!shared.chatId) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'Shared story has no chat.' });
		}
		const story = await storyQueries.getStoryByChatAndSlug(shared.chatId, shared.slug);
		if (!story) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		const { storyOwnerId, canRefresh } = await getStoryRefreshAccess(story.id, ctx.user.id, ctx.userRole);
		if (!storyOwnerId) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Live Story has no execution owner.' });
		}
		if (!canRefresh) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the Story owner or an admin can refresh this.' });
		}
		const activity = await activityQueries.startStoryRefreshActivity({
			projectId: shared.projectId,
			userId: storyOwnerId,
			storyId: story.id,
			chatId: story.chatId,
			trigger: 'manual',
		});
		try {
			return await withKeyedLock(`story:${story.id}`, async () => {
				const { queryData } = await refreshStoryData(shared.chatId!, shared.slug);
				await activityQueries.completeActivity(activity.id, {
					queriesRefreshed: Object.keys(queryData).length,
				});
				logAnalyticsEvent({
					projectId: shared.projectId,
					type: 'refresh',
					assetType: 'story',
					actorUserId: ctx.user.id,
					storyId: story.id,
					chatId: shared.chatId,
					sharedStoryId: shared.id,
					metadata: { type: 'refresh', trigger: 'manual', queriesRefreshed: Object.keys(queryData).length },
				});
				return { queryData, cachedAt: new Date() };
			});
		} catch (err) {
			await activityQueries.failActivity(activity.id, err instanceof Error ? err.message : String(err));
			throw err;
		}
	}),

	getSharedStoryInfo: projectProtectedProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input, ctx }) => {
			const notShared = { shareId: null, visibility: null, allowedUserIds: [], allowedGroupIds: [] };
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!story) {
				return notShared;
			}
			const storyProjectId = story.projectId ?? (await storyQueries.getStoryProjectId(story.id));
			if (storyProjectId !== ctx.project.id) {
				return notShared;
			}
			const access = await sharedStoryQueries.getStoryShareAccess(story.id, ctx.project.id);
			if (!access) {
				return notShared;
			}

			return {
				shareId: access.shareId,
				visibility: access.visibility,
				allowedUserIds: access.allowedUserIds,
				allowedGroupIds: await filterShareableUserGroupIds(ctx.project.id, access.allowedGroupIds),
			};
		}),

	listShareableGroups: projectProtectedProcedure.query(async ({ ctx }) => {
		return listShareableUserGroups(ctx.project.id);
	}),

	updateAccess: shareProcedure
		.input(
			z.object({
				shareId: z.string(),
				allowedUserIds: z.array(z.string()),
				allowedGroupIds: z.array(z.string()).default([]),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const shared = ctx.resource;

			if (shared.userId !== ctx.user.id && ctx.userRole !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can update this.' });
			}
			await assertShareableUserGroupIds(shared.projectId, input.allowedGroupIds);

			const previousRecipientIds = new Set(
				await sharedStoryQueries.getSharedStoryRecipientUserIds(input.shareId),
			);
			await sharedStoryQueries.updateSharedStoryRecipients(input.shareId, {
				userIds: input.allowedUserIds,
				groupIds: input.allowedGroupIds,
			});
			const currentRecipientIds = await sharedStoryQueries.getSharedStoryRecipientUserIds(input.shareId);

			const newlyAddedUserIds = currentRecipientIds.filter((id) => !previousRecipientIds.has(id));
			if (newlyAddedUserIds.length > 0) {
				await notifySharedItem({
					projectId: shared.projectId,
					sharerId: shared.userId,
					sharerName: shared.authorName,
					shareId: input.shareId,
					itemLabel: 'story',
					itemTitle: shared.title,
					visibility: 'specific',
					allowedUserIds: newlyAddedUserIds,
				});
			}
		}),

	togglePin: adminProtectedProcedure
		.input(z.object({ sharedStoryId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const share = await sharedStoryQueries.getSharedStory(input.sharedStoryId);
			if (!share) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared story not found.' });
			}
			if (share.projectId !== ctx.project.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'This story does not belong to the current project.',
				});
			}
			await sharedStoryQueries.toggleSharedStoryPin(input.sharedStoryId);
		}),

	delete: shareProcedure.input(z.object({ shareId: z.string() })).mutation(async ({ input, ctx }) => {
		if (ctx.resource.userId !== ctx.user.id && ctx.userRole !== 'admin') {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can delete this.' });
		}
		await sharedStoryQueries.deleteSharedStory(input.shareId);
		const storyOwnerId = (await storyQueries.getStoryOwnerId(ctx.resource.storyId)) ?? ctx.resource.userId;
		await storyFolderQueries.ensureStoryPrivate(ctx.resource.storyId, {
			storyOwnerId,
			projectId: ctx.resource.projectId,
		});
		await teardownStoryDelivery(ctx.resource.storyId);
	}),

	download: shareAccessProcedure
		.input(
			z.object({
				shareId: z.string(),
				format: z.enum(DOWNLOAD_FORMATS),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;

			const version = input.versionNumber
				? await storyQueries.getVersionByNumber(shared.chatId!, shared.slug, input.versionNumber)
				: await storyQueries.getLatestVersionByChatAndSlug(shared.chatId!, shared.slug);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story version not found.' });
			}

			const { queryData, code } = await getStoryQueryData(
				shared.chatId!,
				shared.slug,
				version.code,
				version.isLive,
				version.cacheSchedule,
			);

			logAnalyticsEvent({
				projectId: shared.projectId,
				type: 'download',
				assetType: 'story',
				actorUserId: ctx.user.id,
				storyId: shared.storyId,
				chatId: shared.chatId,
				sharedStoryId: shared.id,
				metadata: {
					type: 'download',
					format: input.format,
					versionNumber: version.version,
					title: version.title,
				},
			});

			const displaySettings = shared.projectId ? await projectQueries.getDisplaySettings(shared.projectId) : null;

			return buildDownloadResponse(input.format, version.title, code, queryData, displaySettings?.dateFormat);
		}),
};

async function getStoryRefreshAccess(
	storyId: string,
	userId: string,
	userRole: UserRole | null,
): Promise<{ storyOwnerId: string | undefined; canRefresh: boolean }> {
	const storyOwnerId = await storyQueries.getStoryOwnerId(storyId);
	return {
		storyOwnerId,
		canRefresh: Boolean(storyOwnerId && (userId === storyOwnerId || userRole === 'admin')),
	};
}

async function getStoryForkAccess(
	shared: { projectId: string; userId: string },
	userId: string,
	userRole: UserRole | null,
): Promise<boolean> {
	if (userRole === 'viewer') {
		return false;
	}
	if (shared.userId === userId) {
		return true;
	}
	return hasUserGroupFeature(shared.projectId, userId, 'storyCreation');
}
