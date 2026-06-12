import { DOWNLOAD_FORMATS, SHARE_VISIBILITY } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as activityQueries from '../queries/activity.queries';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { logActivity } from '../services/activity';
import { executeLiveQuery, getStoryQueryData, refreshStoryData } from '../services/live-story';
import { notifySharedItemRecipients } from '../utils/email';
import { buildDownloadResponse } from '../utils/story-download';
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
				pinAfterCreate: z.boolean().optional(),
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

			if (input.visibility === 'project') {
				await storyFolderQueries.moveStoryToFolder(story.id, null, {
					storyOwnerId: ctx.user.id,
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
				input.allowedUserIds,
				{ pinned: input.pinAfterCreate === true },
			);

			await logActivity({
				projectId: ctx.project.id,
				userId: ctx.user.id,
				type: 'story.shared',
				storyId: story.id,
				sharedStoryId: created.id,
			});

			notifySharedItemRecipients({
				projectId: ctx.project.id,
				sharerId: ctx.user.id,
				sharerName: ctx.user.name,
				shareId: created.id,
				itemLabel: 'story',
				itemTitle: story.title,
				visibility: input.visibility,
				allowedUserIds: input.allowedUserIds,
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

		const { queryData, cachedAt } = await getStoryQueryData(
			shared.chatId!,
			shared.slug,
			shared.code,
			isLive,
			cacheSchedule,
		);

		return {
			...shared,
			storyId: shared.storyId,
			queryData,
			isLive,
			isLiveTextDynamic,
			cacheSchedule,
			cacheScheduleDescription,
			cachedAt,
			userRole: ctx.userRole,
		};
	}),

	getLiveQueryData: chatProcedure
		.input(z.object({ chatId: z.string(), queryId: z.string() }))
		.query(async ({ input }) => {
			return executeLiveQuery(input.chatId, input.queryId);
		}),

	refreshData: shareAccessProcedure.input(z.object({ shareId: z.string() })).mutation(async ({ ctx }) => {
		const shared = ctx.resource;
		const story = await storyQueries.getStoryByChatAndSlug(shared.chatId!, shared.slug);
		const storyOwnerId = story ? await storyQueries.getStoryOwnerId(story.id) : undefined;
		const activity =
			story && storyOwnerId
				? await activityQueries.startStoryRefreshActivity({
						projectId: shared.projectId,
						userId: storyOwnerId,
						storyId: story.id,
						chatId: story.chatId,
						trigger: 'manual',
					})
				: null;
		try {
			const { queryData } = await refreshStoryData(shared.chatId!, shared.slug);
			if (activity) {
				await activityQueries.completeActivity(activity.id, {
					queriesRefreshed: Object.keys(queryData).length,
				});
			}
			return { queryData, cachedAt: new Date() };
		} catch (err) {
			if (activity) {
				await activityQueries.failActivity(activity.id, err instanceof Error ? err.message : String(err));
			}
			throw err;
		}
	}),

	getSharedStoryInfo: projectProtectedProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!story) {
				return { shareId: null, visibility: null, allowedUserIds: [] };
			}

			const share = await sharedStoryQueries.getSharedStoryInfo(story.id, ctx.project.id);
			if (!share) {
				return { shareId: null, visibility: null, allowedUserIds: [] };
			}

			const allowedUserIds =
				share.visibility === 'specific' ? await sharedStoryQueries.getSharedStoryAllowedUserIds(share.id) : [];

			return { shareId: share.id, visibility: share.visibility, allowedUserIds };
		}),

	updateAccess: shareProcedure
		.input(z.object({ shareId: z.string(), allowedUserIds: z.array(z.string()) }))
		.mutation(async ({ input, ctx }) => {
			const shared = ctx.resource;

			if (shared.userId !== ctx.user.id && ctx.userRole !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can update this.' });
			}

			const previousAllowedUserIds = await sharedStoryQueries.getSharedStoryAllowedUserIds(input.shareId);
			await sharedStoryQueries.updateSharedStoryAllowedUsers(input.shareId, input.allowedUserIds);

			const newlyAddedUserIds = input.allowedUserIds.filter((id) => !previousAllowedUserIds.includes(id));
			if (newlyAddedUserIds.length > 0) {
				await notifySharedItemRecipients({
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

			const { queryData } = await getStoryQueryData(
				shared.chatId!,
				shared.slug,
				version.code,
				version.isLive,
				version.cacheSchedule,
			);

			return buildDownloadResponse(input.format, version.title, version.code, queryData);
		}),
};
