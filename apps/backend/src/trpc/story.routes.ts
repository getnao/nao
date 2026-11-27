import { BULK_ITEMS_LIMIT } from '@nao/shared';
import { STORY_KIT_EDITABLE_BLOCKS } from '@nao/shared/story-app';
import { extractQueryIds } from '@nao/shared/story-segments';
import type { BulkStoryItem, StoryFormat, UserRole } from '@nao/shared/types';
import { DOWNLOAD_FORMATS, NOTIFICATION_CHANNELS, RECIPIENT_MODES, STORY_DOWNLOAD_FORMATS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as activityQueries from '../queries/activity.queries';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import type { StoryEditHolder } from '../queries/story-edit-lock.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import * as storyReferenceQueries from '../queries/story-reference.queries';
import * as storyViewerDataCacheQueries from '../queries/story-viewer-data-cache.queries';
import { agentService } from '../services/agent';
import { readCustomStoryChartPluginSources } from '../services/chart-plugin';
import { naturalLanguageToCron } from '../services/cron-nlp';
import {
	assertCustomStoryExists,
	getActiveThemeForProject,
	getActiveThemeForStory,
	getCustomStoryFile,
	getCustomStoryId,
	getCustomStoryNarratives,
	getCustomStoryQueryData,
	getCustomStoryQuerySql,
	getCustomStoryVersion,
	getEditorCustomStoryQueryData,
	getEditorCustomStoryQuerySql,
} from '../services/custom-story';
import { listCustomStoryModels, runCustomStoryModel } from '../services/custom-story-model';
import { assertWriterAddsNoMarkdownChatQueries } from '../services/custom-story-query-access';
import { runCustomStorySql } from '../services/custom-story-sql';
import { getCustomStoryState, setCustomStoryState } from '../services/custom-story-state';
import {
	executeLiveQuery,
	executeStoryLiveQuery,
	getStandaloneStoryLiveQueryData,
	getStoryQueryData,
	requireStoryByChatAndSlug,
	requireStoryById,
} from '../services/live-story';
import { listShareableGroups } from '../services/project-sharing.service';
import { listSharedStoriesForViewer } from '../services/shared-story.service';
import {
	appendCustomStoryBlock,
	editCustomStoryBlock,
	restoreCustomStoryVersion,
	saveCustomStoryFiles,
	StoryBlockEditError,
} from '../services/story-block-edit';
import {
	getStoryDeliverySettings,
	listStoryDeliveryRecipientGroups,
	listStoryDeliveryRecipients,
	updateStoryDelivery,
} from '../services/story-delivery.service';
import {
	acquireStoryEditLock,
	assertStoryEditable,
	getStoryEditLockState,
	releaseStoryEditLock,
	StoryEditLockedError,
} from '../services/story-edit-lock.service';
import {
	filterOptionsRequestSchema,
	getStoryFilterOptions,
	getStoryFilterOptionsByStoryId,
} from '../services/story-filter-options';
import {
	assertStoryFiltersEnabled,
	getFilteredStoryQueryData,
	getFilteredStoryQueryDataByStoryId,
	getStoryFilterTargets,
	getStoryFilterTargetsByStoryId,
	getStoryQuerySql,
	getStoryQuerySqlByStoryId,
} from '../services/story-filters';
import { readCustomStoryMapBoundary } from '../services/story-map-boundary';
import { listMostViewedStories } from '../services/story-reference';
import {
	refreshStoryManually,
	unscheduleStoryRefreshJob,
	updateStoryLiveSettings,
} from '../services/story-refresh.service';
import { assertCanManageStoryShare, type ShareActor } from '../services/story-share-settings.service';
import {
	describeTransferredStory,
	listStoryRecipients,
	StoryTransferError,
	transferAllStoriesOfUser,
	transferStory,
} from '../services/story-transfer.service';
import { listStoryVersionChanges } from '../services/story-version-history';
import { logAnalyticsEvent } from '../utils/analytics-event';
import {
	mapBoundaryKey,
	storyModelRequest,
	storyQueryInputs,
	storySnapshotHtml,
	storySqlRequest,
	storyStateChange,
	toCustomStoryQueryTrpcError,
	toCustomStoryTrpcError,
} from '../utils/custom-story-trpc';
import { buildDownloadResponse } from '../utils/story-download';
import { themeFontStylesheets } from '../utils/story-headless-page';
import { StoryKitJsxEditError } from '../utils/story-kit-jsx';
import { backfillMissingQueryData, getStandaloneStoryQueryData, withKpiPreviewData } from '../utils/story-query-data';
import { buildStorySnapshotDownload } from '../utils/story-snapshot';
import { extractStorySummary } from '../utils/story-summary';
import {
	adminProtectedProcedure,
	canSendProcedure,
	cloudBillingMiddleware,
	cloudBillingProjectProcedure,
	ownedResourceProcedure,
	projectProtectedProcedure,
	protectedProcedure,
} from './trpc';
import { assertUserGroupFeatureForTrpc } from './user-group-feature-access';

const chatOwnerProcedure = ownedResourceProcedure(chatQueries.getChatOwnerId, 'chat');
const storyOwnerProcedure = ownedResourceProcedure(storyQueries.getStoryOwnerId, 'story');
const chatStoryProcedure = chatOwnerProcedure.use(async ({ ctx, getRawInput, next }) => {
	const input = (await getRawInput()) as { chatId: string };
	const projectId = await chatQueries.getChatProjectId(input.chatId);
	if (!projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
	}
	if (!(await canAccessStoryProject(projectId, ctx.user.id))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
	}
	return next({ ctx: { projectId } });
});
const cloudBillingChatStoryProcedure = chatStoryProcedure.use(
	cloudBillingMiddleware<{ projectId: string }>(({ projectId }) => ({ projectId })),
);
const storyEditorProcedure = protectedProcedure.use(async ({ ctx, getRawInput, next }) => {
	const input = (await getRawInput()) as { chatId?: unknown; storySlug?: unknown };
	if (typeof input.chatId !== 'string' || typeof input.storySlug !== 'string') {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'chatId and storySlug are required.' });
	}
	const projectId = await chatQueries.getChatProjectId(input.chatId);
	if (!projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
	}
	const isChatOwner = (await chatQueries.getChatOwnerId(input.chatId)) === ctx.user.id;
	if (!isChatOwner && !(await isChatStoryEditor(input.chatId, input.storySlug, ctx.user.id))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not authorized to modify this story.' });
	}
	if (!(await canAccessStoryProject(projectId, ctx.user.id))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
	}
	return next({ ctx: { projectId, isChatOwner } });
});
const cloudBillingStoryEditorProcedure = storyEditorProcedure.use(
	cloudBillingMiddleware<{ projectId: string }>(({ projectId }) => ({ projectId })),
);
const storyOwnerProjectProcedure = storyOwnerProcedure.use(async ({ ctx, getRawInput, next }) => {
	const input = (await getRawInput()) as { storyId: string };
	const projectId = await storyQueries.getStoryProjectId(input.storyId);
	if (!projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	if (!(await canAccessStoryProject(projectId, ctx.user.id))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
	}
	return next({ ctx: { projectId } });
});
const cloudBillingStoryOwnerProjectProcedure = storyOwnerProjectProcedure.use(
	cloudBillingMiddleware<{ projectId: string }>(({ projectId }) => ({ projectId })),
);

const chatStoryInput = z.object({ chatId: z.string(), storySlug: z.string() });
const storyFilterSelectionsInput = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
const liveSettingsInput = z.object({
	isLive: z.boolean(),
	isLiveTextDynamic: z.boolean(),
	cacheSchedule: z.string().nullable(),
	cacheScheduleDescription: z.string().nullable(),
});
const deliverySettingsInput = z.object({
	enabled: z.boolean(),
	cron: z.string().nullable(),
	scheduleDescription: z.string().nullable(),
	channels: z.array(z.enum(NOTIFICATION_CHANNELS)).min(1),
	recipientMode: z.enum(RECIPIENT_MODES),
	recipientUserIds: z.array(z.string()),
	recipientGroupIds: z.array(z.string()).default([]),
});

const storyKitBlockComponent = z.enum(STORY_KIT_EDITABLE_BLOCKS);
const editSessionInput = z.object({ storyId: z.string(), sessionId: z.string().min(1).max(64) });

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

async function isChatStoryEditor(chatId: string, storySlug: string, userId: string): Promise<boolean> {
	const story = await storyQueries.getStoryByChatAndSlug(chatId, storySlug);
	return !!story && (await sharedStoryQueries.getStoryShareRole(story.id, userId)) === 'editor';
}

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
			const items = visibleStories.map(({ code, ...rest }) => ({
				...rest,
				storySlug: rest.slug,
				summary: extractStorySummary(code),
				sharing: sharingByStoryId.get(rest.id) ?? null,
			}));
			return withKpiPreviewData(items, (story) => story.id);
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
			const items = visibleStories.map(({ code, ...rest }) => ({
				...rest,
				storySlug: rest.slug,
				summary: extractStorySummary(code),
				sharing: sharingByStoryId.get(rest.id) ?? null,
			}));
			return withKpiPreviewData(items, (story) => story.id);
		}),

	listStandalone: projectProtectedProcedure.query(async ({ ctx }) => {
		const stories = await storyQueries.listUserStandaloneStories(ctx.user.id, ctx.project.id);
		const items = stories.map(({ code, ...rest }) => ({
			...rest,
			storySlug: rest.slug,
			summary: extractStorySummary(code),
		}));
		return withKpiPreviewData(items, (story) => story.id);
	}),

	listStandaloneArchived: projectProtectedProcedure.query(async ({ ctx }) => {
		const stories = await storyQueries.listUserStandaloneStories(ctx.user.id, ctx.project.id, { archived: true });
		const items = stories.map(({ code, ...rest }) => ({
			...rest,
			storySlug: rest.slug,
			summary: extractStorySummary(code),
		}));
		return withKpiPreviewData(items, (story) => story.id);
	}),

	listReferenceable: projectProtectedProcedure.query(async ({ ctx }) => {
		const stories = await storyReferenceQueries.listAllReferenceableStoryListings(ctx.user.id, ctx.project.id);
		return stories.map(toReferenceableStoryItem);
	}),

	listMostViewed: projectProtectedProcedure
		.input(z.object({ limit: z.number().int().min(1).max(20) }))
		.query(async ({ input, ctx }) => {
			const stories = await listMostViewedStories(
				{ userId: ctx.user.id, projectId: ctx.project.id },
				input.limit,
			);
			return stories.map(toReferenceableStoryItem);
		}),

	resolve: protectedProcedure.input(z.object({ storyId: z.string() })).query(async ({ input, ctx }) => {
		const story = await storyQueries.getStoryById(input.storyId);
		if (!story) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		const [ownerId, projectId, latestVersion, shareRole] = await Promise.all([
			storyQueries.getStoryOwnerId(story.id),
			storyQueries.getStoryProjectId(story.id),
			storyQueries.getLatestVersionByStoryId(story.id),
			sharedStoryQueries.getStoryShareRole(story.id, ctx.user.id),
		]);
		await assertCanOpenStory(story.id, projectId, ctx.user.id);
		const isOwner = ownerId === ctx.user.id;
		return {
			storyId: story.id,
			chatId: story.chatId,
			slug: story.slug,
			title: story.title,
			format: story.format,
			summary: extractStorySummary(latestVersion?.code ?? ''),
			isOwner,
			canEdit: isOwner || shareRole === 'editor',
			isArchived: story.archivedAt !== null,
			projectId,
		};
	}),

	getEditState: protectedProcedure.input(editSessionInput).query(async ({ input, ctx }) => {
		await assertCanOpenStory(input.storyId, await storyQueries.getStoryProjectId(input.storyId), ctx.user.id);
		const [latest, lock] = await Promise.all([
			storyQueries.getLatestVersionStamp(input.storyId),
			getStoryEditLockState(input.storyId, manualHolder(ctx.user.id, input.sessionId)),
		]);
		return { latestVersion: latest?.version ?? null, latestAuthorName: latest?.authorName ?? null, lock };
	}),

	acquireEditLock: protectedProcedure.input(editSessionInput).mutation(async ({ input, ctx }) => {
		await assertCanEditStory(input.storyId, ctx.user.id);
		await withStoryLockErrors(async () => {
			await acquireStoryEditLock(input.storyId, manualHolder(ctx.user.id, input.sessionId));
		});
	}),

	releaseEditLock: protectedProcedure.input(editSessionInput).mutation(async ({ input, ctx }) => {
		await releaseStoryEditLock(input.storyId, manualHolder(ctx.user.id, input.sessionId));
	}),

	listQuickQuestions: protectedProcedure.input(z.object({ storyId: z.string() })).query(async ({ input, ctx }) => {
		await assertCanOpenStory(input.storyId, await storyQueries.getStoryProjectId(input.storyId), ctx.user.id);
		return chatQueries.listQuickQuestionChats(ctx.user.id, input.storyId);
	}),

	listMentioningChats: protectedProcedure.input(z.object({ storyId: z.string() })).query(async ({ input, ctx }) => {
		const story = await storyQueries.getStoryById(input.storyId);
		if (!story) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		const projectId = await assertCanOpenStory(
			story.id,
			await storyQueries.getStoryProjectId(story.id),
			ctx.user.id,
		);
		const chats = await storyReferenceQueries.listMentioningChats(ctx.user.id, projectId, story.id, story.chatId);
		return { storySlug: story.slug, chats };
	}),

	getIdByChatAndSlug: protectedProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!story) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}
			await assertCanOpenStory(story.id, await storyQueries.getStoryProjectId(story.id), ctx.user.id);
			return { storyId: story.id };
		}),

	getStandalone: storyOwnerProjectProcedure.input(z.object({ storyId: z.string() })).query(async ({ input, ctx }) => {
		const story = await storyQueries.getStoryByIdForUser(input.storyId, ctx.user.id);
		if (!story) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		const [cache, lastRefreshFailure, theme] = await Promise.all([
			storyQueries.getStoryDataCacheByStoryId(input.storyId),
			activityQueries.getLatestStoryRefreshFailure(input.storyId),
			getActiveThemeForStory(input.storyId),
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

		const storyData = story.chatId
			? await getStoryQueryData(story.chatId, story.slug, story.code, story.isLive, story.cacheSchedule, {
					viewerUserId: ctx.user.id,
				})
			: await getStandaloneStoryLiveQueryData(story.id, story.code, story.isLive, story.cacheSchedule, {
					deferRefresh: lastRefreshFailure !== null,
					deferFirstRefresh: true,
				});
		const queryData =
			storyData.allowsPersistedFallback && story.chatId
				? await backfillMissingQueryData(story.code, cache?.queryData ?? null, { chatId: story.chatId })
				: storyData.queryData;

		return {
			...story,
			code: storyData.code,
			queryData,
			cachedAt: storyData.cachedAt,
			needsRefresh: storyData.needsRefresh ?? false,
			lastRefreshFailure,
			theme,
		};
	}),

	listStandaloneVersions: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string() }))
		.query(async ({ input, ctx }) => {
			const story = await getStandaloneClassicStory(input.storyId);
			const [versions, changes] = await Promise.all([
				storyQueries.listStoryVersionsByStoryId(story.id),
				listStoryVersionChanges(story, ctx.user.id),
			]);
			return {
				id: story.id as string | null,
				title: story.title,
				archivedAt: story.archivedAt,
				versions: versions.map((version) => ({ ...version, change: changes.get(version.version) ?? null })),
			};
		}),

	getStandaloneVersionQueryData: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string(), versionNumber: z.number().int().positive() }))
		.query(async ({ input }) => {
			const version = await storyQueries.getVersionByStoryIdAndNumber(input.storyId, input.versionNumber);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story version not found.' });
			}
			const { queryData } = await getStandaloneStoryQueryData(input.storyId, version.code);
			return { queryData };
		}),

	createStandaloneVersion: storyOwnerProjectProcedure
		.input(
			z.object({
				storyId: z.string(),
				code: z.string().min(1),
				basedOnVersion: z.number().int().positive(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const story = await getStandaloneClassicStory(input.storyId);
			await withStoryLockErrors(async () => {
				await assertStoryEditable(story.id, manualHolder(ctx.user.id));
			});
			return storyQueries
				.createStandaloneVersion({
					userId: ctx.user.id,
					projectId: story.projectId,
					slug: story.slug,
					title: story.title,
					code: input.code,
					action: 'replace',
					source: 'user',
					origin: 'editor',
					basedOnVersion: input.basedOnVersion,
				})
				.catch((error) => {
					if (error instanceof storyQueries.StoryVersionConflictError) {
						throw new TRPCError({ code: 'CONFLICT', message: error.message });
					}
					throw error;
				});
		}),

	getLatest: storyEditorProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input, ctx }) => {
			const version = await storyQueries.getLatestVersionByChatAndSlug(input.chatId, input.storySlug);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}
			const [lastRefreshFailure, theme] = await Promise.all([
				activityQueries.getLatestStoryRefreshFailure(version.storyId),
				getActiveThemeForStory(version.storyId),
			]);
			const { queryData, cachedAt, code, needsRefresh } = await getStoryQueryData(
				input.chatId,
				input.storySlug,
				version.code,
				version.isLive,
				version.cacheSchedule,
				{
					deferRefresh: ctx.isChatOwner && lastRefreshFailure !== null,
					deferFirstRefresh: ctx.isChatOwner,
					viewerUserId: ctx.isChatOwner ? ctx.user.id : undefined,
				},
			);

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

			return {
				...version,
				code,
				queryData,
				cachedAt,
				lastRefreshFailure,
				needsRefresh: needsRefresh ?? false,
				theme,
			};
		}),

	listVersions: storyEditorProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!story) {
				return {
					movedStory: await describeTransferredStory(input.chatId, input.storySlug, ctx.user.id),
					id: null as string | null,
					title: input.storySlug,
					format: 'classic' as StoryFormat,
					isLive: false,
					isLiveTextDynamic: false,
					cacheSchedule: null as string | null,
					cacheScheduleDescription: null as string | null,
					archivedAt: null as Date | null,
					versions: [],
				};
			}

			const [versions, changes] = await Promise.all([
				storyQueries.listStoryVersions(input.chatId, input.storySlug),
				listStoryVersionChanges(story, ctx.user.id),
			]);
			return {
				movedStory: null,
				id: story.id as string | null,
				title: story.title,
				format: story.format,
				isLive: story.isLive,
				isLiveTextDynamic: story.isLiveTextDynamic,
				cacheSchedule: story.cacheSchedule,
				cacheScheduleDescription: story.cacheScheduleDescription,
				archivedAt: story.archivedAt,
				versions: versions.map((version) => ({ ...version, change: changes.get(version.version) ?? null })),
			};
		}),

	getVersionQueryData: storyEditorProcedure
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

	getCustomVersion: storyEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input }) => {
			try {
				return await getCustomStoryVersion(input.chatId, input.storySlug, input.versionNumber);
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	getCustomVersionFile: storyEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				path: z.string(),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input }) => {
			try {
				return await getCustomStoryFile(input.chatId, input.storySlug, input.path, input.versionNumber);
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	getCustomStoryQueryData: storyEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				queryId: z.string(),
				versionNumber: z.number().int().positive().optional(),
				inputs: storyQueryInputs,
			}),
		)
		.query(async ({ input, ctx }) => {
			const { chatId, storySlug, queryId, versionNumber, inputs } = input;
			const rerun = { inputs, viewerId: ctx.user.id };
			try {
				return ctx.isChatOwner
					? await getCustomStoryQueryData(chatId, storySlug, queryId, { deferRefresh: true, rerun })
					: await getEditorCustomStoryQueryData(chatId, storySlug, queryId, {
							deferRefresh: true,
							versionNumber,
							rerun,
						});
			} catch (error) {
				throw toCustomStoryQueryTrpcError(error);
			}
		}),

	runCustomStorySql: cloudBillingStoryEditorProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string(), request: storySqlRequest }))
		.mutation(async ({ input, ctx }) => {
			try {
				await assertCustomStoryExists(input.chatId, input.storySlug);
				return await runCustomStorySql(
					{
						projectId: ctx.projectId,
						chatId: input.chatId,
						viewerId: ctx.user.id,
						billingAccessVerifiedProjectId: ctx.projectId,
					},
					input.request,
				);
			} catch (error) {
				throw toCustomStoryQueryTrpcError(error);
			}
		}),

	listCustomStoryModels: storyEditorProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(({ ctx }) => listCustomStoryModels(ctx.projectId, ctx.user.id)),

	runCustomStoryModel: cloudBillingStoryEditorProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string(), request: storyModelRequest }))
		.mutation(async ({ input, ctx }) => {
			try {
				const storyId = await getCustomStoryId(input.chatId, input.storySlug);
				return await runCustomStoryModel(
					{
						projectId: ctx.projectId,
						storyId,
						viewerId: ctx.user.id,
						billingAccessVerifiedProjectId: ctx.projectId,
					},
					input.request,
				);
			} catch (error) {
				throw toCustomStoryQueryTrpcError(error);
			}
		}),

	getCustomStoryQuerySql: storyEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				queryId: z.string(),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const { chatId, storySlug, queryId, versionNumber } = input;
			try {
				const sqlQuery = ctx.isChatOwner
					? await getCustomStoryQuerySql(chatId, storySlug, queryId)
					: await getEditorCustomStoryQuerySql(chatId, storySlug, queryId, versionNumber);
				return { sqlQuery };
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	getCustomStoryNarratives: storyEditorProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input }) => {
			try {
				return await getCustomStoryNarratives(input.chatId, input.storySlug, { deferRefresh: true });
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	getCustomStoryChartPlugins: storyEditorProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(({ input }) => readCustomStoryChartPluginSources(input.chatId, input.storySlug)),

	getCustomStoryMapBoundary: storyEditorProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string(), key: mapBoundaryKey }))
		.query(({ input }) => readCustomStoryMapBoundary(input.chatId, input.storySlug, input.key)),

	getCustomStoryState: storyEditorProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input, ctx }) => {
			try {
				return await getCustomStoryState(input.chatId, input.storySlug, ctx.user.id);
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	setCustomStoryState: storyEditorProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string(), change: storyStateChange }))
		.mutation(async ({ input, ctx }) => {
			try {
				await setCustomStoryState(input.chatId, input.storySlug, ctx.user.id, input.change);
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	downloadCustom: storyEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				format: z.enum(DOWNLOAD_FORMATS),
				html: storySnapshotHtml,
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const version = input.versionNumber
				? await storyQueries.getVersionByNumber(input.chatId, input.storySlug, input.versionNumber)
				: await storyQueries.getLatestVersionByChatAndSlug(input.chatId, input.storySlug);
			if (!version || version.format !== 'custom') {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

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

			const fontStylesheets = themeFontStylesheets(await getActiveThemeForStory(version.storyId));
			return buildStorySnapshotDownload(input.format, version.title, input.html, fontStylesheets);
		}),

	editCustomStoryBlock: storyEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				versionNumber: z.number().int().positive(),
				block: z.object({ component: storyKitBlockComponent, props: z.record(z.string(), z.unknown()) }),
				change: z.object({
					component: storyKitBlockComponent.optional(),
					set: z.record(z.string(), z.unknown()),
					unset: z.array(z.string()),
				}),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await assertNoOneElseEditing(input.chatId, input.storySlug, ctx.user.id);
			if (agentService.get(input.chatId)) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'The agent is working on this chat. Edit the story once it is done.',
				});
			}
			try {
				return await editCustomStoryBlock({ ...input, authorId: ctx.user.id });
			} catch (error) {
				if (error instanceof StoryBlockEditError || error instanceof StoryKitJsxEditError) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
				}
				throw toCustomStoryTrpcError(error);
			}
		}),

	appendCustomStoryBlock: storyEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				versionNumber: z.number().int().positive(),
				block: z.object({ component: storyKitBlockComponent, props: z.record(z.string(), z.unknown()) }),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await assertNoOneElseEditing(input.chatId, input.storySlug, ctx.user.id);
			if (agentService.get(input.chatId)) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'The agent is working on this chat. Add to the story once it is done.',
				});
			}
			try {
				return await appendCustomStoryBlock({ ...input, authorId: ctx.user.id });
			} catch (error) {
				if (error instanceof StoryBlockEditError || error instanceof StoryKitJsxEditError) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
				}
				throw toCustomStoryTrpcError(error);
			}
		}),

	saveCustomStoryFiles: storyEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				versionNumber: z.number().int().positive(),
				files: z
					.array(z.object({ path: z.string(), content: z.string() }))
					.min(1)
					.max(60),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await assertNoOneElseEditing(input.chatId, input.storySlug, ctx.user.id);
			if (agentService.get(input.chatId)) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'The agent is working on this chat. Save your changes once it is done.',
				});
			}
			const projectId = await chatQueries.getChatProjectId(input.chatId);
			if (!projectId) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
			}
			await assertUserGroupFeatureForTrpc(projectId, ctx.user.id, 'customStoryCreation');
			try {
				return await saveCustomStoryFiles({ ...input, authorId: ctx.user.id });
			} catch (error) {
				if (error instanceof StoryBlockEditError) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
				}
				throw toCustomStoryTrpcError(error);
			}
		}),

	restoreCustomVersion: storyEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				versionNumber: z.number().int().positive(),
				restoreVersionNumber: z.number().int().positive(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await assertNoOneElseEditing(input.chatId, input.storySlug, ctx.user.id);
			if (agentService.get(input.chatId)) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'The agent is working on this chat. Restore the version once it is done.',
				});
			}
			try {
				return await restoreCustomStoryVersion({ ...input, authorId: ctx.user.id });
			} catch (error) {
				if (error instanceof StoryBlockEditError) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
				}
				throw toCustomStoryTrpcError(error);
			}
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

	getCertification: projectProtectedProcedure
		.input(z.object({ storyId: z.string() }))
		.query(async ({ input, ctx }) => {
			await getStoryInProject(input.storyId, ctx.project.id);
			if (!(await storyQueries.canUserAccessStory(input.storyId, ctx.user.id))) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}
			return storyQueries.getStoryCertification(input.storyId);
		}),

	toggleCertification: adminProtectedProcedure
		.input(z.object({ storyId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const story = await getStoryInProject(input.storyId, ctx.project.id);
			const certifiedBy = story.certifiedAt === null ? ctx.user.id : null;
			const certifiedAt = await storyQueries.setStoryCertification(story.id, certifiedBy);
			return { certifiedAt };
		}),

	listTransferRecipients: canSendProcedure.input(z.object({ storyId: z.string() })).query(async ({ input, ctx }) => {
		const story = await getStoryInProject(input.storyId, ctx.project.id);
		const actor = toShareActor(ctx);
		await assertCanManageStoryShare(story, actor);
		const ownerId = (await storyQueries.getStoryOwnerId(story.id)) ?? ctx.user.id;
		return listStoryRecipients(actor, ownerId);
	}),

	transferOwnership: canSendProcedure
		.input(z.object({ storyId: z.string(), recipientId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			await withStoryTransferErrors(() => transferStory(input.storyId, input.recipientId, toShareActor(ctx)));
		}),

	countOwnedStories: adminProtectedProcedure.input(z.object({ userId: z.string() })).query(async ({ input, ctx }) => {
		const storyIds = await storyQueries.listOwnedStoryIdsInProject(input.userId, ctx.project.id);
		return { count: storyIds.length };
	}),

	transferAllFromUser: adminProtectedProcedure
		.input(z.object({ fromUserId: z.string(), recipientId: z.string() }))
		.mutation(({ input, ctx }) =>
			withStoryTransferErrors(() =>
				transferAllStoriesOfUser(input.fromUserId, input.recipientId, toShareActor(ctx)),
			),
		),

	createVersion: storyEditorProcedure
		.input(
			z
				.object({
					chatId: z.string(),
					storySlug: z.string(),
					title: z.string().min(1),
					code: z.string().min(1),
					action: z.enum(['create', 'update', 'replace']),
					basedOnVersion: z.number().int().positive().optional(),
				})
				.refine((value) => value.action !== 'replace' || value.basedOnVersion !== undefined, {
					message: 'Replacing a story requires the version it is based on.',
					path: ['basedOnVersion'],
				}),
		)
		.mutation(async ({ input, ctx }) => {
			await assertNoOneElseEditing(input.chatId, input.storySlug, ctx.user.id);
			const existingStory = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (existingStory?.format === 'custom') {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Custom stories are versioned from their files, not from markdown.',
				});
			}
			if (!existingStory) {
				const projectId = await chatQueries.getChatProjectId(input.chatId);
				if (!projectId) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
				}
				await assertUserGroupFeatureForTrpc(projectId, ctx.user.id, 'storyCreation');
			}
			await assertWriterAddsNoMarkdownChatQueries(input.chatId, input.storySlug, ctx.user.id, input.code).catch(
				(error) => {
					throw toCustomStoryTrpcError(error);
				},
			);
			const version = await storyQueries
				.createStoryVersion({
					chatId: input.chatId,
					slug: input.storySlug,
					title: input.title,
					code: input.code,
					action: input.action,
					basedOnVersion: input.basedOnVersion,
					source: 'user',
					origin: 'editor',
					authorId: ctx.user.id,
					sourceChatId: null,
				})
				.catch((error) => {
					if (error instanceof storyQueries.StoryVersionConflictError) {
						throw new TRPCError({ code: 'CONFLICT', message: error.message });
					}
					throw error;
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
		.input(chatStoryInput.extend(liveSettingsInput.shape))
		.mutation(async ({ input }) => {
			const { chatId, storySlug, ...settings } = input;
			const story = await requireStoryByChatAndSlug(chatId, storySlug);
			await updateStoryLiveSettings(story.id, settings);
		}),

	getStandaloneLiveSettings: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string() }))
		.query(async ({ input }) => {
			const story = await requireStoryById(input.storyId);
			return {
				id: story.id,
				isLive: story.isLive,
				isLiveTextDynamic: story.isLiveTextDynamic,
				cacheSchedule: story.cacheSchedule,
				cacheScheduleDescription: story.cacheScheduleDescription,
			};
		}),

	updateStandaloneLiveSettings: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string(), ...liveSettingsInput.shape }))
		.mutation(async ({ input }) => {
			const { storyId, ...settings } = input;
			await updateStoryLiveSettings(storyId, settings);
		}),

	getDelivery: chatOwnerProcedure.input(chatStoryInput).query(async ({ input }) => {
		const story = await requireStoryByChatAndSlug(input.chatId, input.storySlug);
		return getStoryDeliverySettings(story.id);
	}),

	getStandaloneDelivery: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string() }))
		.query(async ({ input }) => getStoryDeliverySettings(input.storyId)),

	listDeliveryRecipients: chatOwnerProcedure.input(chatStoryInput).query(async ({ input, ctx }) => {
		const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
		return story ? listStoryDeliveryRecipients(story.id, ctx.user.id) : [];
	}),

	listStandaloneDeliveryRecipients: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string() }))
		.query(async ({ input, ctx }) => listStoryDeliveryRecipients(input.storyId, ctx.user.id)),

	listDeliveryRecipientGroups: chatOwnerProcedure.input(chatStoryInput).query(async ({ input, ctx }) => {
		const projectId = await chatQueries.getChatProjectId(input.chatId);
		if (!projectId) {
			return [];
		}
		return listShareableGroups(projectId, ctx.user.id);
	}),

	listStandaloneDeliveryRecipientGroups: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string() }))
		.query(async ({ input, ctx }) => listStoryDeliveryRecipientGroups(input.storyId, ctx.user.id)),

	updateDelivery: chatOwnerProcedure
		.input(chatStoryInput.extend(deliverySettingsInput.shape))
		.mutation(async ({ input, ctx }) => {
			const { chatId, storySlug, ...settings } = input;
			const story = await requireStoryByChatAndSlug(chatId, storySlug);
			await updateStoryDelivery(story, settings, ctx.user);
		}),

	updateStandaloneDelivery: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string(), ...deliverySettingsInput.shape }))
		.mutation(async ({ input, ctx }) => {
			const { storyId, ...settings } = input;
			await updateStoryDelivery(await requireStoryById(storyId), settings, ctx.user);
		}),

	refreshData: cloudBillingChatStoryProcedure.input(chatStoryInput).mutation(async ({ input, ctx }) => {
		const story = await requireStoryByChatAndSlug(input.chatId, input.storySlug);
		const result = await refreshStoryManually(story, {
			actorUserId: ctx.user.id,
			billingAccessVerifiedProjectId: ctx.projectId,
		});
		await storyViewerDataCacheQueries.deleteStoryViewerDataCache(story.id);
		return result;
	}),

	refreshStandaloneData: cloudBillingStoryOwnerProjectProcedure
		.input(z.object({ storyId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const story = await requireStoryById(input.storyId);
			const result = await refreshStoryManually(story, {
				actorUserId: ctx.user.id,
				billingAccessVerifiedProjectId: ctx.projectId,
			});
			await storyViewerDataCacheQueries.deleteStoryViewerDataCache(story.id);
			return result;
		}),

	getLiveQueryData: cloudBillingChatStoryProcedure
		.input(z.object({ chatId: z.string(), queryId: z.string(), storySlug: z.string().optional() }))
		.query(async ({ input, ctx }) => {
			const storyVersion = input.storySlug
				? await storyQueries.getLatestVersionByChatAndSlug(input.chatId, input.storySlug)
				: null;
			return executeLiveQuery(input.chatId, input.queryId, {
				billingAccessVerifiedProjectId: ctx.projectId,
				storyCode: storyVersion?.code,
			});
		}),

	getStandaloneLiveQueryData: cloudBillingStoryOwnerProjectProcedure
		.input(z.object({ storyId: z.string(), queryId: z.string() }))
		.query(async ({ input, ctx }) => {
			const story = await requireStoryById(input.storyId);
			const version = await storyQueries.getLatestVersionByStoryId(story.id);
			if (!version || !extractQueryIds(version.code).has(input.queryId)) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Query not found in this story.' });
			}
			return executeStoryLiveQuery({ id: story.id, chatId: story.chatId }, input.queryId, {
				billingAccessVerifiedProjectId: ctx.projectId,
				storyCode: version.code,
			});
		}),

	getFilterOptions: cloudBillingStoryEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				filterId: z.string(),
				...filterOptionsRequestSchema.shape,
			}),
		)
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			const { chatId, storySlug, filterId, ...request } = input;
			return getStoryFilterOptions(chatId, storySlug, filterId, request, {
				billingAccessVerifiedProjectId: ctx.projectId,
			});
		}),

	getFilteredQueryData: cloudBillingStoryEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				selections: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
			}),
		)
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			return getFilteredStoryQueryData(input.chatId, input.storySlug, input.selections, {
				billingAccessVerifiedProjectId: ctx.projectId,
			});
		}),

	getFilterTargets: storyEditorProcedure
		.input(
			z.object({ chatId: z.string(), storySlug: z.string(), selections: storyFilterSelectionsInput.default({}) }),
		)
		.query(async ({ input }) => {
			assertStoryFiltersEnabled();
			return getStoryFilterTargets(input.chatId, input.storySlug, input.selections);
		}),

	getQuerySql: storyEditorProcedure
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

	getStandaloneFilterOptions: cloudBillingStoryOwnerProjectProcedure
		.input(z.object({ storyId: z.string(), filterId: z.string(), ...filterOptionsRequestSchema.shape }))
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			const { storyId, filterId, ...request } = input;
			return getStoryFilterOptionsByStoryId(storyId, filterId, request, {
				billingAccessVerifiedProjectId: ctx.projectId,
			});
		}),

	getStandaloneFilteredQueryData: cloudBillingStoryOwnerProjectProcedure
		.input(z.object({ storyId: z.string(), selections: storyFilterSelectionsInput }))
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			return getFilteredStoryQueryDataByStoryId(input.storyId, input.selections, {
				billingAccessVerifiedProjectId: ctx.projectId,
			});
		}),

	getStandaloneFilterTargets: storyOwnerProjectProcedure
		.input(z.object({ storyId: z.string(), selections: storyFilterSelectionsInput.default({}) }))
		.query(async ({ input }) => {
			assertStoryFiltersEnabled();
			return getStoryFilterTargetsByStoryId(input.storyId, input.selections);
		}),

	getStandaloneQuerySql: storyOwnerProjectProcedure
		.input(
			z.object({
				storyId: z.string(),
				queryId: z.string(),
				selections: storyFilterSelectionsInput.default({}),
			}),
		)
		.query(async ({ input }) => {
			return getStoryQuerySqlByStoryId(input.storyId, input.queryId, input.selections);
		}),

	parseCronFromText: cloudBillingProjectProcedure
		.input(z.object({ text: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			const cron = await naturalLanguageToCron(ctx.project.id, ctx.user.id, input.text);
			return { cron };
		}),

	archive: chatStoryProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.mutation(async ({ input }) => {
			await storyQueries.archiveStory(input.chatId, input.storySlug);
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (story) {
				await unscheduleStoryRefreshJob(story.id);
			}
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
		const stories = await sharedStoryQueries.listUserSharedStories(ctx.project.id, ctx.user.id, { archived: true });
		return listSharedStoriesForViewer(stories, ctx.project.id, ctx.user.id);
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
		.input(
			z.object({
				storyId: z.string(),
				format: z.enum(STORY_DOWNLOAD_FORMATS),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByIdForUser(input.storyId, ctx.user.id);
			if (!story) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}
			const content =
				input.versionNumber !== undefined && input.versionNumber !== story.version
					? await getStandaloneHistoricalDownloadContent(story.id, input.versionNumber)
					: await getStandaloneLatestDownloadContent(story);

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
						versionNumber: content.versionNumber,
						title: content.title,
					},
				});
			}

			const [displaySettings, theme] = story.projectId
				? await Promise.all([
						projectQueries.getDisplaySettings(story.projectId),
						getActiveThemeForProject(story.projectId),
					])
				: [null, null];
			return buildDownloadResponse(
				input.format,
				content.title,
				content.code,
				content.queryData,
				displaySettings?.dateFormat,
				theme,
			);
		}),

	download: storyEditorProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				format: z.enum(STORY_DOWNLOAD_FORMATS),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const latestVersion = await storyQueries.getLatestVersionByChatAndSlug(input.chatId, input.storySlug);
			const version = input.versionNumber
				? await storyQueries.getVersionByNumber(input.chatId, input.storySlug, input.versionNumber)
				: latestVersion;
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

			const isHistoricalVersion = input.versionNumber !== undefined && version.version !== latestVersion?.version;
			const { queryData, code } = isHistoricalVersion
				? {
						queryData: await sharedStoryQueries.getQueryDataFromCode(input.chatId, version.code),
						code: version.code,
					}
				: await getStoryQueryData(
						input.chatId,
						input.storySlug,
						version.code,
						version.isLive,
						version.cacheSchedule,
						{ viewerUserId: ctx.isChatOwner ? ctx.user.id : undefined },
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

			const [displaySettings, theme] = projectId
				? await Promise.all([projectQueries.getDisplaySettings(projectId), getActiveThemeForProject(projectId)])
				: [null, null];

			return buildDownloadResponse(
				input.format,
				version.title,
				code,
				queryData,
				displaySettings?.dateFormat,
				theme,
			);
		}),
};

function toReferenceableStoryItem(story: storyReferenceQueries.ReferenceableStoryListing) {
	return {
		storyId: story.storyId,
		chatId: story.chatId,
		title: story.title,
		format: story.format,
		authorName: story.authorName,
		isPinned: story.isPinned,
		isCertified: story.isCertified,
		isSharedWithMe: story.isSharedWithMe,
	};
}

async function assertCanOpenStory(storyId: string, projectId: string | null, userId: string): Promise<string> {
	const hasProjectAccess = projectId ? await canAccessStoryProject(projectId, userId) : false;
	if (!projectId || !hasProjectAccess || !(await storyQueries.canUserAccessStory(storyId, userId))) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	return projectId;
}

async function assertCanEditStory(storyId: string, userId: string): Promise<void> {
	const projectId = await assertCanOpenStory(storyId, await storyQueries.getStoryProjectId(storyId), userId);
	const isOwner = (await storyQueries.getStoryOwnerId(storyId)) === userId;
	if (!isOwner && (await sharedStoryQueries.getStoryShareRole(storyId, userId)) !== 'editor') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not authorized to modify this story.' });
	}
	if (!(await canAccessStoryProject(projectId, userId))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
	}
}

function manualHolder(userId: string, sessionId: string | null = null): StoryEditHolder {
	return { userId, chatId: null, sessionId };
}

async function assertNoOneElseEditing(chatId: string, storySlug: string, userId: string): Promise<void> {
	const story = await storyQueries.getStoryByChatAndSlug(chatId, storySlug);
	if (story) {
		await withStoryLockErrors(async () => {
			await assertStoryEditable(story.id, manualHolder(userId));
		});
	}
}

async function withStoryLockErrors<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof StoryEditLockedError) {
			throw new TRPCError({ code: 'CONFLICT', message: error.message });
		}
		throw error;
	}
}

/** A markdown story outside any chat: its versions are saved on the story itself rather than through a chat. */
async function getStandaloneClassicStory(storyId: string) {
	const story = await storyQueries.getStoryById(storyId);
	if (!story || story.chatId !== null || !story.projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	if (story.format === 'custom') {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Custom stories are versioned from their files, not from markdown.',
		});
	}
	return { ...story, projectId: story.projectId };
}

async function getStandaloneLatestDownloadContent(story: storyQueries.UserStoryRow) {
	const cache = await storyQueries.getStoryDataCacheByStoryId(story.id);
	const storyData = story.chatId
		? await getStoryQueryData(story.chatId, story.slug, story.code, story.isLive, story.cacheSchedule, {
				viewerUserId: story.userId ?? undefined,
			})
		: await getStandaloneStoryLiveQueryData(story.id, story.code, story.isLive, story.cacheSchedule);
	const queryData =
		storyData.allowsPersistedFallback && story.chatId
			? await backfillMissingQueryData(story.code, cache?.queryData ?? null, { chatId: story.chatId })
			: storyData.queryData;
	return { title: story.title, code: storyData.code, queryData, versionNumber: story.version };
}

async function getStandaloneHistoricalDownloadContent(storyId: string, versionNumber: number) {
	const version = await storyQueries.getVersionByStoryIdAndNumber(storyId, versionNumber);
	if (!version) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story version not found.' });
	}
	const { queryData } = await getStandaloneStoryQueryData(storyId, version.code);
	return { title: version.title, code: version.code, queryData, versionNumber: version.version };
}

async function withStoryTransferErrors<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof StoryTransferError) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
		}
		throw error;
	}
}

function toShareActor(ctx: {
	user: { id: string; name: string };
	userRole: UserRole | null;
	project: { id: string };
}): ShareActor {
	return { id: ctx.user.id, name: ctx.user.name, role: ctx.userRole, projectId: ctx.project.id };
}

async function getStoryInProject(storyId: string, projectId: string) {
	const story = await storyQueries.getStoryById(storyId);
	const storyProjectId = story ? await storyQueries.getStoryProjectId(story.id) : null;
	if (!story || storyProjectId !== projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	return story;
}

async function filterStoriesByProjectAccess(
	stories: Awaited<ReturnType<typeof storyQueries.listUserChatStories>>,
	userId: string,
	explicitProjectId?: string,
) {
	if (explicitProjectId) {
		if (!(await canAccessStoryProject(explicitProjectId, userId))) {
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
			hasAccess: await canAccessStoryProject(projectId, userId),
		})),
	);
	const accessibleProjectIds = new Set(
		projectAccess.filter(({ hasAccess }) => hasAccess).map(({ projectId }) => projectId),
	);
	return stories.filter((story) => story.projectId !== null && accessibleProjectIds.has(story.projectId));
}

async function canAccessStoryProject(projectId: string, userId: string): Promise<boolean> {
	return Boolean(await projectQueries.getUserRoleInProject(projectId, userId));
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
