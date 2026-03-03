import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import { extractStorySummary } from '../utils/story-summary';
import { projectProtectedProcedure, protectedProcedure } from './trpc';

export const sharedStoryRoutes = {
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		const stories = await sharedStoryQueries.listProjectSharedStories(ctx.project.id, ctx.user.id);
		return stories.map((story) => ({
			...story,
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
			const latestVersion = await storyQueries.getLatestVersion(input.chatId, input.storyId);
			if (!latestVersion) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

			return sharedStoryQueries.createSharedStory(
				{
					projectId: ctx.project.id,
					userId: ctx.user.id,
					chatId: input.chatId,
					storyId: input.storyId,
					visibility: input.visibility,
				},
				input.allowedUserIds,
			);
		}),

	get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
		const story = await sharedStoryQueries.getSharedStory(input.id);
		if (!story) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared story not found.' });
		}

		const member = await projectQueries.getProjectMember(story.projectId, ctx.user.id);
		if (!member) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
		}

		if (story.visibility === 'specific' && story.userId !== ctx.user.id) {
			const hasAccess = await sharedStoryQueries.canUserAccessSharedStory(story.id, ctx.user.id);
			if (!hasAccess) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
			}
		}

		const queryData = await sharedStoryQueries.collectQueryData(story.chatId, story.code);

		return { ...story, queryData };
	}),

	findByStory: protectedProcedure
		.input(z.object({ chatId: z.string(), storyId: z.string() }))
		.query(async ({ input, ctx }) => {
			const share = await sharedStoryQueries.findByStory(input.chatId, input.storyId, ctx.user.id);
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
			const story = await sharedStoryQueries.getSharedStory(input.id);
			if (!story) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared story not found.' });
			}

			if (story.projectId !== ctx.project.id) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
			}

			if (story.userId !== ctx.user.id && ctx.userRole !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can update this.' });
			}

			await sharedStoryQueries.updateAllowedUsers(input.id, input.allowedUserIds);
		}),

	delete: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const story = await sharedStoryQueries.getSharedStory(input.id);
		if (!story) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared story not found.' });
		}

		if (story.userId !== ctx.user.id && ctx.userRole !== 'admin') {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can delete this.' });
		}

		await sharedStoryQueries.deleteSharedStory(input.id);
	}),
};
