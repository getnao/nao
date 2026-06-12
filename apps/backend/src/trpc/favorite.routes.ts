import { TRPCError } from '@trpc/server';

import * as favoriteQueries from '../queries/favorite.queries';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { projectProtectedProcedure } from './trpc';

export const favoriteRoutes = {
	toggle: projectProtectedProcedure.input(favoriteQueries.favoriteTargetSchema).mutation(async ({ input, ctx }) => {
		if (input.type === 'story') {
			const canAccess = await storyQueries.canUserAccessStory(input.id, ctx.user.id);
			if (!canAccess) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
			}
		} else {
			const folder = await storyFolderQueries.getFolderById(input.id);
			if (!folder || (folder.visibility === 'private' && folder.ownerId !== ctx.user.id)) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found.' });
			}
			const userRole = await projectQueries.getUserRoleInProject(folder.projectId, ctx.user.id);
			if (!userRole) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found.' });
			}
		}

		const isFavorited = await favoriteQueries.toggleFavorite(ctx.user.id, { type: input.type, id: input.id });
		return { isFavorited };
	}),

	list: projectProtectedProcedure.query(async ({ ctx }) => {
		return favoriteQueries.listFavorites(ctx.user.id, ctx.project.id);
	}),
};
