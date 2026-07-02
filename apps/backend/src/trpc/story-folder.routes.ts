import type { UserRole } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import type { DBStoryFolder } from '../db/abstractSchema';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { canSendProcedure, projectProtectedProcedure } from './trpc';

async function assertFolderInProject(
	folderId: string,
	ctx: { user: { id: string }; project: { id: string } },
	label = 'Folder',
) {
	const folder = await storyFolderQueries.getFolderById(folderId);
	if (!folder || folder.projectId !== ctx.project.id) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `${label} not found.` });
	}
	return folder;
}

function assertCanModifyFolder(folder: DBStoryFolder, userId: string, userRole: UserRole | null) {
	if (folder.ownerId !== userId && userRole !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner or an admin can modify this folder.' });
	}
}

function assertCanReadPrivateFolder(folder: DBStoryFolder, userId: string, label = 'Folder') {
	if (folder.visibility === 'private' && folder.ownerId !== userId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `${label} not found.` });
	}
}

function assertCanPlaceInDestination(target: DBStoryFolder | null, userId: string) {
	if (target && target.visibility === 'private' && target.ownerId !== userId) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'You can only move items into your own private folder.',
		});
	}
}

function assertCanChangeFolderScope(folder: DBStoryFolder, target: DBStoryFolder | null, userId: string) {
	const newVisibility = target ? target.visibility : 'public';
	if (folder.visibility !== newVisibility && folder.ownerId !== userId) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: "Only the owner can change a folder's visibility.",
		});
	}
}

export const storyFolderRoutes = {
	listTree: projectProtectedProcedure
		.input(z.object({ archived: z.boolean().optional() }).optional())
		.query(async ({ ctx, input }) => {
			const isViewer = ctx.userRole === 'viewer';
			if (!input?.archived && !isViewer) {
				await storyFolderQueries.ensurePrivateRoot(ctx.user.id, ctx.project.id);
			}
			return storyFolderQueries.listFolderTree(ctx.user.id, ctx.project.id, {
				archived: input?.archived,
				isViewer,
			});
		}),

	listItems: projectProtectedProcedure.query(async ({ ctx }) => {
		return storyFolderQueries.listFolderItemsForProject(ctx.user.id, ctx.project.id, {
			isViewer: ctx.userRole === 'viewer',
		});
	}),

	create: canSendProcedure
		.input(
			z.object({
				name: z.string().min(1).max(100),
				parentId: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			let parent: DBStoryFolder | null = null;
			if (input.parentId) {
				parent = await assertFolderInProject(input.parentId, ctx, 'Parent folder');
				assertCanReadPrivateFolder(parent, ctx.user.id, 'Parent folder');
			}
			assertCanPlaceInDestination(parent, ctx.user.id);
			return storyFolderQueries.createFolder({
				ownerId: ctx.user.id,
				projectId: ctx.project.id,
				name: input.name,
				parentId: input.parentId ?? null,
			});
		}),

	rename: canSendProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).max(100).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const folder = await assertFolderInProject(input.id, ctx);
			assertCanReadPrivateFolder(folder, ctx.user.id);
			assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);
			await storyFolderQueries.updateFolder(input.id, { name: input.name });
		}),

	delete: canSendProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const folder = await assertFolderInProject(input.id, ctx);
		assertCanReadPrivateFolder(folder, ctx.user.id);
		assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);
		await storyFolderQueries.deleteFolderMovingContentsToParent(input.id);
	}),

	archive: canSendProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const folder = await assertFolderInProject(input.id, ctx);
		assertCanReadPrivateFolder(folder, ctx.user.id);
		assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);
		await storyFolderQueries.archiveFolder(input.id);
	}),

	unarchive: canSendProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const folder = await assertFolderInProject(input.id, ctx);
		assertCanReadPrivateFolder(folder, ctx.user.id);
		assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);
		await storyFolderQueries.unarchiveFolder(ctx.user.id, ctx.project.id, input.id);
	}),

	move: canSendProcedure
		.input(z.object({ id: z.string(), newParentId: z.string().nullable() }))
		.mutation(async ({ input, ctx }) => {
			const folder = await assertFolderInProject(input.id, ctx);
			assertCanReadPrivateFolder(folder, ctx.user.id);
			assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);

			let target: DBStoryFolder | null = null;
			if (input.newParentId) {
				target = await assertFolderInProject(input.newParentId, ctx, 'Target folder');
				assertCanReadPrivateFolder(target, ctx.user.id, 'Target folder');
			}
			assertCanPlaceInDestination(target, ctx.user.id);
			assertCanChangeFolderScope(folder, target, ctx.user.id);

			try {
				await storyFolderQueries.moveFolder(ctx.user.id, ctx.project.id, input.id, input.newParentId);
			} catch (err) {
				if (err instanceof storyFolderQueries.MoveFolderCycleError) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
				}
				if (err instanceof storyFolderQueries.SystemFolderError) {
					throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
				}
				throw err;
			}
		}),

	moveStory: canSendProcedure
		.input(z.object({ storyId: z.string(), folderId: z.string().nullable() }))
		.mutation(async ({ input, ctx }) => {
			const storyProjectId = await storyQueries.getStoryProjectId(input.storyId);
			if (storyProjectId !== ctx.project.id) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found in this project.' });
			}

			const storyOwnerId = await storyQueries.getStoryOwnerId(input.storyId);
			if (!storyOwnerId) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
			}

			if (storyOwnerId !== ctx.user.id && ctx.userRole !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner or an admin can move this story.' });
			}

			let target: DBStoryFolder | null = null;
			if (input.folderId) {
				target = await assertFolderInProject(input.folderId, ctx);
				assertCanReadPrivateFolder(target, ctx.user.id);
			}

			assertCanPlaceInDestination(target, ctx.user.id);

			await storyFolderQueries.moveStoryToFolder(input.storyId, input.folderId, {
				storyOwnerId,
				projectId: ctx.project.id,
			});
		}),
};
