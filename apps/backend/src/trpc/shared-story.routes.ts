import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import { projectProtectedProcedure, protectedProcedure } from './trpc';

export const sharedStoryRoutes = {
	create: projectProtectedProcedure
		.input(
			z.object({
				title: z.string().min(1).max(500),
				code: z.string().min(1),
				queryData: z.record(z.string(), z.array(z.unknown())).nullable().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return sharedStoryQueries.createSharedStory({
				projectId: ctx.project.id,
				userId: ctx.user.id,
				title: input.title,
				code: input.code,
				queryData: input.queryData ?? null,
			});
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

		return story;
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
