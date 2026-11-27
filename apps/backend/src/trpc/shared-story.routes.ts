import { extractQueryIds } from '@nao/shared/story-segments';
import { prepareRestrictedStoryCode } from '@nao/shared/story-viewer-restrictions';
import {
	DOWNLOAD_FORMATS,
	SHARE_ROLES,
	SHARE_VISIBILITY,
	STORY_DOWNLOAD_FORMATS,
	type StoryFormat,
	type UserRole,
} from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import type { DBStory } from '../db/abstractSchema';
import * as activityQueries from '../queries/activity.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyViewerDataCacheQueries from '../queries/story-viewer-data-cache.queries';
import { readStoryChartPluginSources } from '../services/chart-plugin';
import {
	assertCustomStoryExists,
	getActiveThemeForProject,
	getActiveThemeForStory,
	getCustomStoryVersion,
	getSharedCustomStoryNarratives,
	getSharedCustomStoryQueryData,
	getSharedCustomStoryQuerySql,
	getStandaloneCustomStoryNarratives,
	getStandaloneCustomStoryQueryData,
	getStandaloneCustomStoryQuerySql,
	getStandaloneCustomStoryVersion,
} from '../services/custom-story';
import { listCustomStoryModels, runCustomStoryModel } from '../services/custom-story-model';
import { runCustomStorySql } from '../services/custom-story-sql';
import {
	getCustomStoryState,
	getCustomStoryStateByStoryId,
	setCustomStoryState,
	setCustomStoryStateByStoryId,
} from '../services/custom-story-state';
import {
	executeLiveQuery,
	executeStoryLiveQuery,
	getStandaloneStoryLiveQueryData,
	getStoryQueryData,
	refreshStoryById,
	resolveRestrictedViewerId,
} from '../services/live-story';
import { listShareableGroups } from '../services/project-sharing.service';
import { filterShareableUserGroupIds } from '../services/shareable-user-groups.service';
import { listSharedStoriesForViewer, unshareStory } from '../services/shared-story.service';
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
import { readStoryMapBoundary } from '../services/story-map-boundary';
import { assertStoryCanRefresh } from '../services/story-refresh.service';
import {
	assertCanManageStoryShare,
	getStoryShareSettings,
	saveStoryShareSettings,
	type ShareActor,
} from '../services/story-share-settings.service';
import { hasEffectiveWarehouseRestrictions } from '../services/user-group-context-access.service';
import { hasUserGroupFeature } from '../services/user-group-feature-access.service';
import { logAnalyticsEvent } from '../utils/analytics-event';
import {
	mapBoundaryKey,
	STANDALONE_SQL_UNAVAILABLE,
	storyModelRequest,
	storyQueryInputs,
	storySnapshotHtml,
	storySqlRequest,
	storyStateChange,
	toCustomStoryQueryTrpcError,
	toCustomStoryTrpcError,
} from '../utils/custom-story-trpc';
import { withKeyedLock } from '../utils/keyed-lock';
import { buildDownloadResponse } from '../utils/story-download';
import { themeFontStylesheets } from '../utils/story-headless-page';
import { getStandaloneStoryQueryData } from '../utils/story-query-data';
import { buildStorySnapshotDownload } from '../utils/story-snapshot';
import {
	adminProtectedProcedure,
	canSendProcedure,
	cloudBillingMiddleware,
	projectProtectedProcedure,
	protectedProcedure,
	resourceProjectProcedure,
} from './trpc';

const shareGrantInput = z.object({ id: z.string(), role: z.enum(SHARE_ROLES) });
const storyToShareInput = z.union([
	z.object({ chatId: z.string(), storySlug: z.string() }),
	z.object({ storyId: z.string() }),
]);
type StoryToShare = z.infer<typeof storyToShareInput>;

const shareProcedure = resourceProjectProcedure('storyId', sharedStoryQueries.getSharedStoryByStoryId, 'Shared story');
const shareAccessProcedure = resourceProjectProcedure(
	'storyId',
	sharedStoryQueries.getSharedStoryByStoryId,
	'Shared story',
	canUserAccessShare,
);
const cloudBillingShareAccessProcedure = shareAccessProcedure.use(
	cloudBillingMiddleware<{ resource: { projectId: string } }>(({ resource }) => ({
		projectId: resource.projectId,
	})),
);
const legacyShareAccessProcedure = resourceProjectProcedure(
	'shareId',
	sharedStoryQueries.getSharedStory,
	'Shared story',
	canUserAccessShare,
);

export const sharedStoryRoutes = {
	list: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ input, ctx }) => {
		if (!(await projectQueries.getUserRoleInProject(input.projectId, ctx.user.id))) {
			return [];
		}
		const stories = await sharedStoryQueries.listUserSharedStories(input.projectId, ctx.user.id);
		const items = await listSharedStoriesForViewer(stories, input.projectId, ctx.user.id);
		return items.map(({ id: _shareId, ...story }) => story);
	}),

	getStoryIdByShareId: legacyShareAccessProcedure
		.input(z.object({ shareId: z.string() }))
		.query(({ ctx }) => ({ storyId: ctx.resource.storyId })),

	get: shareAccessProcedure.input(z.object({ storyId: z.string() })).query(async ({ ctx }) => {
		const { id: shareId, ownerUserId: _ownerUserId, ...shared } = ctx.resource;
		const storyRow = await storyQueries.getStoryById(shared.storyId);
		const isLive = storyRow?.isLive ?? false;
		const isLiveTextDynamic = storyRow?.isLiveTextDynamic ?? false;
		const cacheSchedule = storyRow?.cacheSchedule ?? null;
		const cacheScheduleDescription = storyRow?.cacheScheduleDescription ?? null;
		const { canRefresh } = await getStoryRefreshAccess(shared.storyId, ctx.user.id, ctx.userRole);
		const canFork = await getStoryForkAccess(shared, ctx.user.id, ctx.userRole);

		const [lastRefreshFailure, theme] = await Promise.all([
			activityQueries.getLatestStoryRefreshFailure(shared.storyId),
			getActiveThemeForStory(shared.storyId),
		]);
		const { queryData, cachedAt, code, needsRefresh } =
			shared.format === 'custom'
				? { queryData: null, cachedAt: null, code: shared.code, needsRefresh: false }
				: shared.chatId
					? await getStoryQueryData(shared.chatId, shared.slug, shared.code, isLive, cacheSchedule, {
							deferRefresh: canRefresh && lastRefreshFailure !== null,
							deferFirstRefresh: canRefresh,
							storyVersionId: shared.storyVersionId,
							viewerUserId: ctx.user.id,
						})
					: await getStandaloneStoryLiveQueryData(shared.storyId, shared.code, isLive, cacheSchedule, {
							deferRefresh: canRefresh && lastRefreshFailure !== null,
							deferFirstRefresh: canRefresh,
						});

		if (ctx.user.id !== shared.userId) {
			logAnalyticsEvent({
				projectId: shared.projectId,
				type: 'page_view',
				assetType: 'story',
				actorUserId: ctx.user.id,
				storyId: shared.storyId,
				chatId: shared.chatId,
				sharedStoryId: shareId,
			});
		}

		return {
			...shared,
			code,
			queryData,
			isLive,
			isLiveTextDynamic,
			cacheSchedule,
			cacheScheduleDescription,
			cachedAt,
			lastRefreshFailure,
			needsRefresh: needsRefresh ?? false,
			theme,
			userRole: ctx.userRole,
			canRefresh,
			canFork,
			isArchived: Boolean(storyRow?.archivedAt),
		};
	}),

	getCustomVersion: shareAccessProcedure
		.input(z.object({ storyId: z.string(), versionNumber: z.number().int().positive().optional() }))
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			try {
				return shared.chatId
					? await getCustomStoryVersion(shared.chatId, shared.slug, input.versionNumber)
					: await getStandaloneCustomStoryVersion(shared.storyId, input.versionNumber);
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	getCustomStoryQuerySql: shareAccessProcedure
		.input(
			z.object({
				storyId: z.string(),
				queryId: z.string(),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			try {
				const sqlQuery = shared.chatId
					? await getSharedCustomStoryQuerySql(shared.chatId, shared.slug, input.queryId, input.versionNumber)
					: await getStandaloneCustomStoryQuerySql(shared.storyId, input.queryId, input.versionNumber);
				return { sqlQuery };
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	getCustomStoryQueryData: shareAccessProcedure
		.input(
			z.object({
				storyId: z.string(),
				queryId: z.string(),
				versionNumber: z.number().int().positive().optional(),
				inputs: storyQueryInputs,
			}),
		)
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			try {
				if (shared.chatId) {
					return await getSharedCustomStoryQueryData(
						shared.chatId,
						shared.slug,
						input.queryId,
						input.versionNumber,
						ctx.user.id,
						input.inputs,
					);
				}
				return getStandaloneCustomStoryQueryData(shared.storyId, input.queryId, input.versionNumber, {
					rerun: { inputs: input.inputs, viewerId: ctx.user.id },
				});
			} catch (error) {
				throw toCustomStoryQueryTrpcError(error);
			}
		}),

	listCustomStoryModels: shareAccessProcedure
		.input(z.object({ storyId: z.string() }))
		.query(({ ctx }) => listCustomStoryModels(ctx.resource.projectId, ctx.user.id)),

	runCustomStoryModel: cloudBillingShareAccessProcedure
		.input(z.object({ storyId: z.string(), request: storyModelRequest }))
		.mutation(async ({ input, ctx }) => {
			const shared = ctx.resource;
			try {
				return await runCustomStoryModel(
					{
						projectId: shared.projectId,
						storyId: shared.storyId,
						viewerId: ctx.user.id,
						billingAccessVerifiedProjectId: shared.projectId,
					},
					input.request,
				);
			} catch (error) {
				throw toCustomStoryQueryTrpcError(error);
			}
		}),

	runCustomStorySql: cloudBillingShareAccessProcedure
		.input(z.object({ storyId: z.string(), request: storySqlRequest }))
		.mutation(async ({ input, ctx }) => {
			const shared = ctx.resource;
			if (!shared.chatId) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: STANDALONE_SQL_UNAVAILABLE });
			}
			try {
				await assertCustomStoryExists(shared.chatId, shared.slug);
				return await runCustomStorySql(
					{
						projectId: shared.projectId,
						chatId: shared.chatId,
						viewerId: ctx.user.id,
						billingAccessVerifiedProjectId: shared.projectId,
					},
					input.request,
				);
			} catch (error) {
				throw toCustomStoryQueryTrpcError(error);
			}
		}),

	getCustomStoryNarratives: shareAccessProcedure.input(z.object({ storyId: z.string() })).query(async ({ ctx }) => {
		const shared = ctx.resource;
		try {
			return shared.chatId
				? await getSharedCustomStoryNarratives(shared.chatId, shared.slug, ctx.user.id)
				: await getStandaloneCustomStoryNarratives(shared.storyId);
		} catch (error) {
			throw toCustomStoryTrpcError(error);
		}
	}),

	getCustomStoryChartPlugins: shareAccessProcedure
		.input(z.object({ storyId: z.string() }))
		.query(({ ctx }) => readStoryChartPluginSources(ctx.resource.storyId)),

	getCustomStoryMapBoundary: shareAccessProcedure
		.input(z.object({ storyId: z.string(), key: mapBoundaryKey }))
		.query(({ ctx, input }) => readStoryMapBoundary(ctx.resource.storyId, input.key)),

	getCustomStoryState: shareAccessProcedure.input(z.object({ storyId: z.string() })).query(async ({ ctx }) => {
		const shared = ctx.resource;
		try {
			return shared.chatId
				? await getCustomStoryState(shared.chatId, shared.slug, ctx.user.id)
				: await getCustomStoryStateByStoryId(shared.storyId, ctx.user.id);
		} catch (error) {
			throw toCustomStoryTrpcError(error);
		}
	}),

	setCustomStoryState: shareAccessProcedure
		.input(z.object({ storyId: z.string(), change: storyStateChange }))
		.mutation(async ({ input, ctx }) => {
			const shared = ctx.resource;
			try {
				if (shared.chatId) {
					await setCustomStoryState(shared.chatId, shared.slug, ctx.user.id, input.change);
				} else {
					await setCustomStoryStateByStoryId(shared.storyId, ctx.user.id, input.change);
				}
			} catch (error) {
				throw toCustomStoryTrpcError(error);
			}
		}),

	downloadCustom: shareAccessProcedure
		.input(z.object({ storyId: z.string(), format: z.enum(DOWNLOAD_FORMATS), html: storySnapshotHtml }))
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

			const fontStylesheets = themeFontStylesheets(await getActiveThemeForStory(shared.storyId));
			return buildStorySnapshotDownload(input.format, shared.title, input.html, fontStylesheets);
		}),

	getVersionQueryData: shareAccessProcedure
		.input(z.object({ storyId: z.string(), versionNumber: z.number().int().positive() }))
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			const version = await storyQueries.getVersionByStoryIdAndNumber(shared.storyId, input.versionNumber);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story version not found.' });
			}

			if (!shared.chatId) {
				return { queryData: (await getStandaloneStoryQueryData(shared.storyId, version.code)).queryData };
			}
			const viewerUserId = await resolveRestrictedViewerId(shared.chatId, ctx.user.id);
			if (!viewerUserId) {
				return { queryData: await sharedStoryQueries.getQueryDataFromCode(shared.chatId, version.code) };
			}
			const { queryData } = await getStoryQueryData(
				shared.chatId,
				shared.slug,
				version.code,
				version.isLive,
				version.cacheSchedule,
				{ storyVersionId: version.id, viewerUserId },
			);
			return { queryData };
		}),

	getLiveQueryData: cloudBillingShareAccessProcedure
		.input(z.object({ storyId: z.string(), queryId: z.string() }))
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			if (!extractQueryIds(shared.code).has(input.queryId)) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Query not found in this story.' });
			}
			const options = { billingAccessVerifiedProjectId: shared.projectId, storyCode: shared.code };
			return shared.chatId
				? executeLiveQuery(shared.chatId, input.queryId, { ...options, viewerUserId: ctx.user.id })
				: executeStoryLiveQuery({ id: shared.storyId, chatId: null }, input.queryId, options);
		}),

	getFilterOptions: cloudBillingShareAccessProcedure
		.input(z.object({ storyId: z.string(), filterId: z.string(), ...filterOptionsRequestSchema.shape }))
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			const shared = ctx.resource;
			const { filterId, search, parentSelection } = input;
			const request = { search, parentSelection };
			const options = { billingAccessVerifiedProjectId: shared.projectId };
			return shared.chatId
				? getStoryFilterOptions(shared.chatId, shared.slug, filterId, request, {
						...options,
						viewerUserId: ctx.user.id,
					})
				: getStoryFilterOptionsByStoryId(shared.storyId, filterId, request, options);
		}),

	getFilteredQueryData: cloudBillingShareAccessProcedure
		.input(
			z.object({
				storyId: z.string(),
				selections: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
			}),
		)
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			const shared = ctx.resource;
			const options = { billingAccessVerifiedProjectId: shared.projectId };
			return shared.chatId
				? getFilteredStoryQueryData(shared.chatId, shared.slug, input.selections, {
						...options,
						viewerUserId: ctx.user.id,
					})
				: getFilteredStoryQueryDataByStoryId(shared.storyId, input.selections, options);
		}),

	getFilterTargets: shareAccessProcedure
		.input(
			z.object({
				storyId: z.string(),
				selections: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
			}),
		)
		.query(async ({ input, ctx }) => {
			assertStoryFiltersEnabled();
			const shared = ctx.resource;
			return shared.chatId
				? getStoryFilterTargets(shared.chatId, shared.slug, input.selections)
				: getStoryFilterTargetsByStoryId(shared.storyId, input.selections);
		}),

	getQuerySql: shareAccessProcedure
		.input(
			z.object({
				storyId: z.string(),
				queryId: z.string(),
				selections: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
			}),
		)
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;
			return shared.chatId
				? getStoryQuerySql(shared.chatId, shared.slug, input.queryId, input.selections)
				: getStoryQuerySqlByStoryId(shared.storyId, input.queryId, input.selections);
		}),

	refreshData: cloudBillingShareAccessProcedure.input(z.object({ storyId: z.string() })).mutation(async ({ ctx }) => {
		const shared = ctx.resource;
		const { storyOwnerId, canRefresh } = await getStoryRefreshAccess(shared.storyId, ctx.user.id, ctx.userRole);
		if (!storyOwnerId) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Live Story has no execution owner.' });
		}
		if (!canRefresh) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the Story owner or an admin can refresh this.' });
		}
		const story = await storyQueries.getStoryById(shared.storyId);
		if (!story) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		assertStoryCanRefresh(story);
		const activity = await activityQueries.startStoryRefreshActivity({
			projectId: shared.projectId,
			userId: storyOwnerId,
			storyId: shared.storyId,
			chatId: shared.chatId,
			trigger: 'manual',
		});
		try {
			return await withKeyedLock(`story:${shared.storyId}`, async () => {
				const { queryData, queriesRefreshed } = await refreshStoryById(shared.storyId, {
					billingAccessVerifiedProjectId: shared.projectId,
				});
				await storyViewerDataCacheQueries.deleteStoryViewerDataCache(story.id);
				await activityQueries.completeActivity(activity.id, { queriesRefreshed });
				logAnalyticsEvent({
					projectId: shared.projectId,
					type: 'refresh',
					assetType: 'story',
					actorUserId: ctx.user.id,
					storyId: shared.storyId,
					chatId: shared.chatId,
					sharedStoryId: shared.id,
					metadata: { type: 'refresh', trigger: 'manual', queriesRefreshed },
				});
				return { queryData, cachedAt: new Date() };
			});
		} catch (err) {
			await activityQueries.failActivity(activity.id, err instanceof Error ? err.message : String(err));
			throw err;
		}
	}),

	getSharedStoryInfo: projectProtectedProcedure.input(storyToShareInput).query(async ({ input, ctx }) => {
		const notShared = {
			isShared: false as const,
			storyId: null,
			visibility: null,
			allowedUserIds: [],
			allowedGroupIds: [],
		};
		const story = await findStoryToShare(input);
		if (!story) {
			return notShared;
		}
		const storyProjectId = story.projectId ?? (await storyQueries.getStoryProjectId(story.id));
		if (storyProjectId !== ctx.project.id) {
			return notShared;
		}
		const storyOwnerId = await storyQueries.getStoryOwnerId(story.id);
		if (storyOwnerId !== ctx.user.id && ctx.userRole !== 'admin') {
			return notShared;
		}
		const access = await sharedStoryQueries.getStoryShareAccess(story.id, ctx.project.id);
		if (!access) {
			return notShared;
		}

		return {
			isShared: true as const,
			storyId: story.id,
			visibility: access.visibility,
			allowedUserIds: access.allowedUserIds,
			allowedGroupIds: await filterShareableUserGroupIds(ctx.project.id, access.allowedGroupIds),
		};
	}),

	listShareableGroups: projectProtectedProcedure.query(async ({ ctx }) => {
		return listShareableGroups(ctx.project.id, ctx.user.id);
	}),

	getShareSettings: projectProtectedProcedure.input(storyToShareInput).query(async ({ input, ctx }) => {
		const story = await findStoryToShare(input);
		const projectId = story && (story.projectId ?? (await storyQueries.getStoryProjectId(story.id)));
		if (!story || projectId !== ctx.project.id) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		return getStoryShareSettings(story, toShareActor(ctx));
	}),

	saveShareSettings: canSendProcedure
		.input(
			z.object({
				storyId: z.string(),
				visibility: z.enum(SHARE_VISIBILITY),
				projectRole: z.enum(SHARE_ROLES).default('viewer'),
				users: z.array(shareGrantInput).default([]),
				groups: z.array(shareGrantInput).default([]),
				notify: z.boolean().default(false),
				folderId: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const { story, actor } = await loadManagedStory(input.storyId, ctx);
			await saveStoryShareSettings(story, actor, input);
		}),

	togglePin: adminProtectedProcedure.input(z.object({ storyId: z.string() })).mutation(async ({ input, ctx }) => {
		const share = await sharedStoryQueries.getSharedStoryByStoryId(input.storyId);
		if (!share) {
			const { story, actor } = await loadManagedStory(input.storyId, ctx);
			await saveStoryShareSettings(story, actor, {
				visibility: 'project',
				projectRole: 'viewer',
				users: [],
				groups: [],
				notify: false,
			});
			await sharedStoryQueries.pinSharedStory(story.id);
			return;
		}
		if (share.projectId !== ctx.project.id) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'This story does not belong to the current project.',
			});
		}
		await sharedStoryQueries.toggleSharedStoryPin(share.id);
	}),

	delete: shareProcedure.input(z.object({ storyId: z.string() })).mutation(async ({ ctx }) => {
		if (ctx.resource.userId !== ctx.user.id && ctx.userRole !== 'admin') {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can delete this.' });
		}
		await unshareStory(ctx.resource);
	}),

	download: shareAccessProcedure
		.input(
			z.object({
				storyId: z.string(),
				format: z.enum(STORY_DOWNLOAD_FORMATS),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;

			const version = input.versionNumber
				? await storyQueries.getVersionByStoryIdAndNumber(shared.storyId, input.versionNumber)
				: await storyQueries.getLatestVersionByStoryId(shared.storyId);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story version not found.' });
			}

			const { queryData, code } = shared.chatId
				? await getStoryQueryData(
						shared.chatId,
						shared.slug,
						version.code,
						version.isLive,
						version.cacheSchedule,
						{ storyVersionId: version.id, viewerUserId: ctx.user.id },
					)
				: await getStandaloneDownloadData(shared.storyId, version, input.versionNumber !== undefined);

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

			const [displaySettings, theme] = shared.projectId
				? await Promise.all([
						projectQueries.getDisplaySettings(shared.projectId),
						getActiveThemeForProject(shared.projectId),
					])
				: [null, null];

			return buildDownloadResponse(
				input.format,
				version.title,
				prepareRestrictedStoryCode(code).code,
				queryData,
				displaySettings?.dateFormat,
				theme,
			);
		}),
};

/** A story with a chat is found by its chat and slug; a standalone story, which has none, by its id. */
function findStoryToShare(input: StoryToShare): Promise<DBStory | null> {
	return 'storyId' in input
		? storyQueries.getStoryById(input.storyId)
		: storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
}

async function canUserAccessShare(
	share: {
		id: string;
		visibility: string;
		userId: string;
		ownerUserId?: string | null;
		chatId?: string | null;
		projectId: string;
	},
	userId: string,
): Promise<boolean> {
	const canAccessShare =
		share.visibility !== 'specific' ||
		share.userId === userId ||
		(await sharedStoryQueries.canUserAccessSharedStory(share.id, userId));
	if (!canAccessShare || share.chatId || share.ownerUserId === userId) {
		return canAccessShare;
	}
	return !(await hasEffectiveWarehouseRestrictions(share.projectId, userId));
}

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
	shared: { projectId: string; userId: string; format: StoryFormat },
	userId: string,
	userRole: UserRole | null,
): Promise<boolean> {
	if (userRole === 'viewer') {
		return false;
	}
	const [canCreateStory, canCreateCustomStory] = await Promise.all([
		shared.userId === userId || hasUserGroupFeature(shared.projectId, userId, 'storyCreation'),
		shared.format !== 'custom' || hasUserGroupFeature(shared.projectId, userId, 'customStoryCreation'),
	]);
	return canCreateStory && canCreateCustomStory;
}

function toShareActor(ctx: {
	user: { id: string; name: string };
	userRole: UserRole | null;
	project: { id: string };
}): ShareActor {
	return { id: ctx.user.id, name: ctx.user.name, role: ctx.userRole, projectId: ctx.project.id };
}

async function loadManagedStory(
	storyId: string,
	ctx: Parameters<typeof toShareActor>[0],
): Promise<{ story: DBStory; actor: ShareActor }> {
	const story = await storyQueries.getStoryById(storyId);
	if (!story) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	const actor = toShareActor(ctx);
	await assertCanManageStoryShare(story, actor);
	return { story, actor };
}

/** An older version is downloaded as it was saved: only the latest one is refreshed when live. */
async function getStandaloneDownloadData(
	storyId: string,
	version: { code: string; isLive: boolean; cacheSchedule: string | null },
	isPickedVersion: boolean,
) {
	return isPickedVersion
		? getStandaloneStoryQueryData(storyId, version.code)
		: getStandaloneStoryLiveQueryData(storyId, version.code, version.isLive, version.cacheSchedule);
}
