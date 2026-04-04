import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import { executeLiveQuery, getStoryQueryData, refreshStoryData } from '../services/live-story';
import { notifySharedItemRecipients } from '../utils/email';
import { extractStorySummary } from '../utils/story-summary';
import { projectProtectedProcedure, protectedProcedure } from './trpc';

export const sharedStoryRoutes = {
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		const stories = await sharedStoryQueries.listProjectSharedStories(ctx.project.id, ctx.user.id);
		return stories.map((story) => ({
			...story,
			storyId: story.slug,
			summary: extractStorySummary(story.code),
		}));
	}),

	create: projectProtectedProcedure
		.input(
			z.object({
				chatId: z.string(),
				storyId: z.string(),
				visibility: z.enum(['project', 'specific']).default('project'),
				allowedUserIds: z.array(z.string()).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storyId);
			if (!story) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

			const created = await sharedStoryQueries.createSharedStory(
				{
					storyId: story.id,
					projectId: ctx.project.id,
					userId: ctx.user.id,
					visibility: input.visibility,
				},
				input.allowedUserIds,
			);

			await notifySharedItemRecipients({
				projectId: ctx.project.id,
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

	get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
		const shared = await sharedStoryQueries.getSharedStory(input.id);
		if (!shared) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared story not found.' });
		}

		const member = await projectQueries.getProjectMember(shared.projectId, ctx.user.id);
		if (!member) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
		}

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
			storyId: shared.slug,
			queryData,
			isLive,
			isLiveTextDynamic,
			cacheSchedule,
			cacheScheduleDescription,
			cachedAt,
		};
	}),

	getLiveQueryData: protectedProcedure
		.input(z.object({ chatId: z.string(), queryId: z.string() }))
		.query(async ({ input, ctx }) => {
			const projectId = await chatQueries.getChatProjectId(input.chatId);
			if (!projectId) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
			}

			const member = await projectQueries.getProjectMember(projectId, ctx.user.id);
			if (!member) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
			}

			return executeLiveQuery(input.chatId, input.queryId);
		}),

	refreshData: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const shared = await sharedStoryQueries.getSharedStory(input.id);
		if (!shared) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared story not found.' });
		}

		const member = await projectQueries.getProjectMember(shared.projectId, ctx.user.id);
		if (!member) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
		}

		if (shared.visibility === 'specific' && shared.userId !== ctx.user.id) {
			const hasAccess = await sharedStoryQueries.canUserAccessSharedStory(shared.id, ctx.user.id);
			if (!hasAccess) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
			}
		}

		const { queryData } = await refreshStoryData(shared.chatId, shared.slug);
		return { queryData, cachedAt: new Date() };
	}),

	findByStory: protectedProcedure
		.input(z.object({ chatId: z.string(), storyId: z.string() }))
		.query(async ({ input, ctx }) => {
			const story = await storyQueries.getStoryByChatAndSlug(input.chatId, input.storyId);
			if (!story) {
				return { shareId: null, visibility: null, allowedUserIds: [] };
			}

			const share = await sharedStoryQueries.findByStory(story.id, ctx.user.id);
			if (!share) {
				return { shareId: null, visibility: null, allowedUserIds: [] };
			}

			const allowedUserIds =
				share.visibility === 'specific' ? await sharedStoryQueries.getSharedStoryAllowedUserIds(share.id) : [];

			return { shareId: share.id, visibility: share.visibility, allowedUserIds };
		}),

	updateAccess: projectProtectedProcedure
		.input(z.object({ id: z.string(), allowedUserIds: z.array(z.string()) }))
		.mutation(async ({ input, ctx }) => {
			const shared = await sharedStoryQueries.getSharedStory(input.id);
			if (!shared) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared story not found.' });
			}

			if (shared.projectId !== ctx.project.id) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
			}

			if (shared.userId !== ctx.user.id && ctx.userRole !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can update this.' });
			}

			const previousAllowedUserIds = await sharedStoryQueries.getSharedStoryAllowedUserIds(input.id);
			await sharedStoryQueries.updateAllowedUsers(input.id, input.allowedUserIds);

			const newlyAddedUserIds = input.allowedUserIds.filter((id) => !previousAllowedUserIds.includes(id));
			if (newlyAddedUserIds.length > 0) {
				await notifySharedItemRecipients({
					projectId: ctx.project.id,
					sharerId: shared.userId,
					sharerName: shared.authorName,
					shareId: input.id,
					itemLabel: 'story',
					itemTitle: shared.title,
					visibility: 'specific',
					allowedUserIds: newlyAddedUserIds,
				});
			}
		}),

	delete: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const shared = await sharedStoryQueries.getSharedStory(input.id);
		if (!shared) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared story not found.' });
		}

		if (shared.userId !== ctx.user.id && ctx.userRole !== 'admin') {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can delete this.' });
		}

		await sharedStoryQueries.deleteSharedStory(input.id);
	}),
};
