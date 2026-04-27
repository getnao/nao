import { DOWNLOAD_FORMATS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import { executeLiveQuery, getStoryQueryData, refreshStoryData } from '../services/live-story';
import { notifySharedItemRecipients } from '../utils/email';
import { buildDownloadResponse } from '../utils/story-download';
import { extractStorySummary } from '../utils/story-summary';
import { projectProtectedProcedure, resourceProjectProcedure } from './trpc';

const shareProcedure = resourceProjectProcedure('shareId', sharedStoryQueries.getSharedStory, 'Shared story');
const chatProcedure = resourceProjectProcedure('chatId', chatQueries.getChatInfo, 'Chat');

export const sharedStoryRoutes = {
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		const stories = await sharedStoryQueries.listProjectSharedStories(ctx.project.id, ctx.user.id);
		return stories.map((story) => ({
			...story,
			storySlug: story.slug,
			summary: extractStorySummary(story.code),
		}));
	}),

	create: chatProcedure
		.input(
			z.object({
				chatId: z.string(),
				storySlug: z.string(),
				visibility: z.enum(['project', 'specific']).default('project'),
				allowedUserIds: z.array(z.string()).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!story) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

			const created = await sharedStoryQueries.createSharedStory(
				{
					storyId: story.id,
					projectId: ctx.resource.projectId,
					userId: ctx.user.id,
					visibility: input.visibility,
				},
				input.allowedUserIds,
			);

			await notifySharedItemRecipients({
				projectId: ctx.resource.projectId,
				sharerId: ctx.user.id,
				sharerName: ctx.user.name,
				shareId: created.id,
				itemLabel: 'story',
				itemTitle: story.title,
				visibility: input.visibility,
				allowedUserIds: input.allowedUserIds,
			});

			return created;
		}),

	get: shareProcedure.input(z.object({ shareId: z.string() })).query(async ({ ctx }) => {
		const shared = ctx.resource;

		if (shared.visibility === 'specific' && shared.userId !== ctx.user.id) {
			const hasAccess = await sharedStoryQueries.canUserAccessSharedStory(shared.id, ctx.user.id);
			if (!hasAccess) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
			}
		}

		const storyRow = await storyQueries.getStoryByChatAndSlug(shared.chatId, shared.slug);
		const isLive = storyRow?.isLive ?? false;
		const isLiveTextDynamic = storyRow?.isLiveTextDynamic ?? false;
		const cacheSchedule = storyRow?.cacheSchedule ?? null;
		const cacheScheduleDescription = storyRow?.cacheScheduleDescription ?? null;

		const { queryData, cachedAt } = await getStoryQueryData(
			shared.chatId,
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
		};
	}),

	getLiveQueryData: chatProcedure
		.input(z.object({ chatId: z.string(), queryId: z.string() }))
		.query(async ({ input }) => {
			return executeLiveQuery(input.chatId, input.queryId);
		}),

	refreshData: shareProcedure.input(z.object({ shareId: z.string() })).mutation(async ({ ctx }) => {
		const shared = ctx.resource;

		if (shared.visibility === 'specific' && shared.userId !== ctx.user.id) {
			const hasAccess = await sharedStoryQueries.canUserAccessSharedStory(shared.id, ctx.user.id);
			if (!hasAccess) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
			}
		}

		const { queryData } = await refreshStoryData(shared.chatId, shared.slug);
		return { queryData, cachedAt: new Date() };
	}),

	getSharedStoryInfo: projectProtectedProcedure
		.input(z.object({ chatId: z.string(), storySlug: z.string() }))
		.query(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storySlug);
			if (!story) {
				return { shareId: null, visibility: null, allowedUserIds: [] };
			}

			const share = await sharedStoryQueries.getSharedStoryInfo(story.id, ctx.user.id);
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

	delete: shareProcedure.input(z.object({ shareId: z.string() })).mutation(async ({ input, ctx }) => {
		if (ctx.resource.userId !== ctx.user.id && ctx.userRole !== 'admin') {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can delete this.' });
		}

		await sharedStoryQueries.deleteSharedStory(input.shareId);
	}),

	download: shareProcedure
		.input(
			z.object({
				shareId: z.string(),
				format: z.enum(DOWNLOAD_FORMATS),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const shared = ctx.resource;

			if (shared.visibility === 'specific' && shared.userId !== ctx.user.id) {
				const hasAccess = await sharedStoryQueries.canUserAccessSharedStory(shared.id, ctx.user.id);
				if (!hasAccess) {
					throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
				}
			}

			const version = input.versionNumber
				? await storyQueries.getVersionByNumber(shared.chatId, shared.slug, input.versionNumber)
				: await storyQueries.getLatestVersion(shared.chatId, shared.slug);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story version not found.' });
			}

			const { queryData } = await getStoryQueryData(
				shared.chatId,
				shared.slug,
				version.code,
				version.isLive,
				version.cacheSchedule,
			);

			return buildDownloadResponse(input.format, version.title, version.code, queryData);
		}),
};
