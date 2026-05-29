import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { projectProtectedProcedure } from './trpc';

async function assertUserOwnsFolder(
	folderId: string,
	ctx: { user: { id: string }; project: { id: string } },
	label = 'Folder',
) {
	const folder = await storyFolderQueries.getFolderById(folderId);
	if (!folder || folder.userId !== ctx.user.id || folder.projectId !== ctx.project.id) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `${label} not found.` });
	}
	return folder;
}

export const storyFolderRoutes = {
	listTree: projectProtectedProcedure
		.input(z.object({ archived: z.boolean().optional() }).optional())
		.query(async ({ ctx, input }) => {
			return storyFolderQueries.listFolderTree(ctx.user.id, ctx.project.id, { archived: input?.archived });
		}),

	listItems: projectProtectedProcedure.query(async ({ ctx }) => {
		return storyFolderQueries.listFolderItemsForUser(ctx.user.id, ctx.project.id);
	}),

	create: projectProtectedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(100),
				parentId: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			if (input.parentId) {
				await assertUserOwnsFolder(input.parentId, ctx, 'Parent folder');
			}
			return storyFolderQueries.createFolder({
				userId: ctx.user.id,
				projectId: ctx.project.id,
				name: input.name,
				parentId: input.parentId ?? null,
			});
		}),

	rename: projectProtectedProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).max(100).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await assertUserOwnsFolder(input.id, ctx);
			await storyFolderQueries.updateFolder(input.id, { name: input.name });
		}),

	delete: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		await assertUserOwnsFolder(input.id, ctx);
		await storyFolderQueries.deleteFolderMovingContentsToParent(input.id);
	}),

	archive: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		await assertUserOwnsFolder(input.id, ctx);
		await storyFolderQueries.archiveFolder(ctx.user.id, input.id);
	}),

	unarchive: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		await assertUserOwnsFolder(input.id, ctx);
		await storyFolderQueries.unarchiveFolder(ctx.user.id, input.id);
	}),

	move: projectProtectedProcedure
		.input(z.object({ id: z.string(), newParentId: z.string().nullable() }))
		.mutation(async ({ input, ctx }) => {
			await assertUserOwnsFolder(input.id, ctx);

			if (input.newParentId) {
				await assertUserOwnsFolder(input.newParentId, ctx, 'Target folder');

				const hasCycle = await storyFolderQueries.detectFolderCycle(input.id, input.newParentId);
				if (hasCycle) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'Moving this folder would create a cycle.' });
				}
			}

			await storyFolderQueries.moveFolder(input.id, input.newParentId);
		}),

	moveStory: projectProtectedProcedure
		.input(z.object({ storyId: z.string(), folderId: z.string().nullable() }))
		.mutation(async ({ input, ctx }) => {
			const canAccess = await storyQueries.canUserAccessStory(input.storyId, ctx.user.id);
			if (!canAccess) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
			}

			if (input.folderId) {
				await assertUserOwnsFolder(input.folderId, ctx);
			}

			await storyFolderQueries.moveStoryToFolder(ctx.user.id, input.storyId, input.folderId);
		}),

	toggleFavorite: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		await assertUserOwnsFolder(input.id, ctx);
		const favoritedAt = await storyFolderQueries.toggleFolderFavorite(ctx.user.id, input.id);
		return { isFavorited: favoritedAt !== null };
	}),
};
