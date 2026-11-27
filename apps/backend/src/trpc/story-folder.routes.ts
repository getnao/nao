import { BULK_ITEMS_LIMIT } from '@nao/shared';
import type { UserRole } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import type { DBStoryFolder } from '../db/abstractSchema';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { assertCanShareWith } from '../services/project-sharing.service';
import { assertShareableUserGroupIds } from '../services/shareable-user-groups.service';
import { getFolderAccess } from '../services/story-folder-access.service';
import {
	assertCanMoveStory,
	assertCanPlaceInDestination,
	assertCanSeeFolder,
	assertCanShareWithAudience,
	assertFolderInProject,
	type FolderContext,
	getViewer,
	moveStoryForUser,
	resolveMoveTarget,
} from '../services/story-folder-move.service';
import { canSendProcedure, projectProtectedProcedure } from './trpc';

function assertCanModifyFolder(folder: DBStoryFolder, userId: string, userRole: UserRole | null) {
	if (folder.ownerId !== userId && userRole !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner or an admin can modify this folder.' });
	}
}

async function assertCanModifyFolders(folderIds: string[], ctx: FolderContext) {
	for (const folderId of folderIds) {
		const folder = await assertFolderInProject(folderId, ctx);
		await assertCanSeeFolder(folder, ctx);
		assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);
	}
}

async function assertCanShareMovedFolder(folderId: string, newParentId: string | null, ctx: FolderContext) {
	const [currentAudience, nextAudience] = await Promise.all([
		storyFolderQueries.resolveFolderAudience(folderId),
		storyFolderQueries.resolveAudienceAfterMove(folderId, newParentId),
	]);
	if (!storyFolderQueries.isSameAudience(currentAudience, nextAudience)) {
		await assertCanShareWithAudience(nextAudience, ctx);
	}
}

function assertCanChangeFolderScope(folder: DBStoryFolder, target: DBStoryFolder | null, userId: string) {
	if (folder.visibility !== resolveDestinationVisibility(target) && folder.ownerId !== userId) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: "Only the owner can change a folder's visibility.",
		});
	}
}

function resolveDestinationVisibility(target: DBStoryFolder | null) {
	return target ? target.visibility : 'public';
}

async function assertCanCreateTeamFolder(groupIds: string[], ctx: FolderContext) {
	if (groupIds.length === 0) {
		return;
	}
	if (!(await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId: ctx.project.id }))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Team folders require an Enterprise license.' });
	}
	await assertShareableUserGroupIds(ctx.project.id, groupIds);
	await assertCanShareWith(ctx.project.id, ctx.user.id, { groupIds });
}

async function assertCanCreateFolder(parentId: string | null, groupIds: string[], ctx: FolderContext) {
	let parent: DBStoryFolder | null = null;
	if (parentId) {
		parent = await assertFolderInProject(parentId, ctx, 'Parent folder');
		await assertCanSeeFolder(parent, ctx, 'Parent folder');
	}
	assertCanPlaceInDestination(parent, ctx.user.id);
	await assertCanCreateTeamFolder(groupIds, ctx);
}

async function assertCanMoveFolder(folderId: string, target: DBStoryFolder | null, ctx: FolderContext) {
	const folder = await assertFolderInProject(folderId, ctx);
	await assertCanSeeFolder(folder, ctx);
	assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);
	assertCanChangeFolderScope(folder, target, ctx.user.id);
	return folder;
}

async function assertTargetOutsideMovedFolders(folderIds: string[], targetFolderId: string | null) {
	if (!targetFolderId) {
		return;
	}
	for (const folderId of folderIds) {
		if (await storyFolderQueries.proposedParentChainContains(targetFolderId, folderId)) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: new storyFolderQueries.MoveFolderCycleError().message,
			});
		}
	}
}

async function assertCanBulkMove(
	input: { storyIds: string[]; folderIds: string[]; targetFolderId: string | null },
	ctx: FolderContext,
) {
	const target = await resolveMoveTarget(input.targetFolderId, ctx);
	await Promise.all(input.folderIds.map((id) => assertCanMoveFolder(id, target, ctx)));
	await assertTargetOutsideMovedFolders(input.folderIds, input.targetFolderId);
	if (input.storyIds.length > 0) {
		await assertCanShareWithAudience(await storyFolderQueries.resolveFolderAudience(input.targetFolderId), ctx);
	}
	for (const folderId of input.folderIds) {
		await assertCanShareMovedFolder(folderId, input.targetFolderId, ctx);
	}
}

async function runFolderMove<T>(move: () => Promise<T>): Promise<T> {
	try {
		return await move();
	} catch (err) {
		if (
			err instanceof storyFolderQueries.MoveFolderCycleError ||
			err instanceof storyFolderQueries.TeamFolderError ||
			err instanceof storyFolderQueries.ArchivedFolderError
		) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
		}
		if (err instanceof storyFolderQueries.SystemFolderError) {
			throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
		}
		throw err;
	}
}

export const storyFolderRoutes = {
	listTree: projectProtectedProcedure
		.input(z.object({ archived: z.boolean().optional() }).optional())
		.query(async ({ ctx, input }) => {
			if (!input?.archived && ctx.userRole !== 'viewer') {
				await storyFolderQueries.ensurePrivateRoot(ctx.user.id, ctx.project.id);
			}
			return storyFolderQueries.listFolderTree(await getViewer(ctx), ctx.project.id, {
				archived: input?.archived,
			});
		}),

	listItems: projectProtectedProcedure.query(async ({ ctx }) => {
		return storyFolderQueries.listFolderItemsForProject(await getViewer(ctx), ctx.project.id);
	}),

	access: projectProtectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
		const folder = await assertFolderInProject(input.id, ctx);
		await assertCanSeeFolder(folder, ctx);
		return getFolderAccess(folder);
	}),

	create: canSendProcedure
		.input(
			z.object({
				name: z.string().min(1).max(100),
				parentId: z.string().nullable().optional(),
				groupIds: z.array(z.string().min(1)).max(BULK_ITEMS_LIMIT).default([]),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return runFolderMove(() =>
				storyFolderQueries.createFolder(
					{
						ownerId: ctx.user.id,
						projectId: ctx.project.id,
						name: input.name,
						parentId: input.parentId ?? null,
						groupIds: input.groupIds,
					},
					() => assertCanCreateFolder(input.parentId ?? null, input.groupIds, ctx),
				),
			);
		}),

	rename: canSendProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).max(100).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await storyFolderQueries.updateFolder(ctx.project.id, input.id, { name: input.name }, () =>
				assertCanModifyFolders([input.id], ctx),
			);
		}),

	delete: canSendProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		await assertFolderInProject(input.id, ctx);
		await storyFolderQueries.deleteFolderMovingContentsToParent(input.id, () =>
			assertCanModifyFolders([input.id], ctx),
		);
	}),

	archive: canSendProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		await storyFolderQueries.archiveFolders(ctx.project.id, [input.id], () =>
			assertCanModifyFolders([input.id], ctx),
		);
	}),

	unarchive: canSendProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		await storyFolderQueries.unarchiveFolders(ctx.user.id, ctx.project.id, [input.id], () =>
			assertCanModifyFolders([input.id], ctx),
		);
	}),

	bulkArchive: canSendProcedure
		.input(z.object({ ids: z.array(z.string()).min(1).max(BULK_ITEMS_LIMIT) }))
		.mutation(async ({ input, ctx }) => {
			await storyFolderQueries.archiveFolders(ctx.project.id, input.ids, () =>
				assertCanModifyFolders(input.ids, ctx),
			);
		}),

	bulkUnarchive: canSendProcedure
		.input(z.object({ ids: z.array(z.string()).min(1).max(BULK_ITEMS_LIMIT) }))
		.mutation(async ({ input, ctx }) => {
			await storyFolderQueries.unarchiveFolders(ctx.user.id, ctx.project.id, input.ids, () =>
				assertCanModifyFolders(input.ids, ctx),
			);
		}),

	move: canSendProcedure
		.input(z.object({ id: z.string(), newParentId: z.string().nullable() }))
		.mutation(async ({ input, ctx }) => {
			await runFolderMove(() =>
				storyFolderQueries.moveFolder(ctx.user.id, ctx.project.id, input.id, input.newParentId, async () => {
					const target = await resolveMoveTarget(input.newParentId, ctx);
					await assertCanMoveFolder(input.id, target, ctx);
					await assertCanShareMovedFolder(input.id, input.newParentId, ctx);
				}),
			);
		}),

	moveStory: canSendProcedure
		.input(z.object({ storyId: z.string(), folderId: z.string().nullable() }))
		.mutation(async ({ input, ctx }) => {
			await moveStoryForUser(input.storyId, input.folderId, ctx);
		}),

	bulkMove: canSendProcedure
		.input(
			z
				.object({
					storyIds: z.array(z.string()).max(BULK_ITEMS_LIMIT),
					folderIds: z.array(z.string()).max(BULK_ITEMS_LIMIT),
					targetFolderId: z.string().nullable(),
				})
				.refine((input) => input.storyIds.length + input.folderIds.length > 0, {
					message: 'Select at least one story or folder to move.',
				}),
		)
		.mutation(async ({ input, ctx }) => {
			const storyOwnerIds = await Promise.all(input.storyIds.map((id) => assertCanMoveStory(id, ctx)));
			const stories = input.storyIds.map((storyId, index) => ({ storyId, storyOwnerId: storyOwnerIds[index] }));
			await runFolderMove(() =>
				storyFolderQueries.moveItemsToFolder(
					ctx.user.id,
					ctx.project.id,
					{ folderIds: input.folderIds, stories },
					input.targetFolderId,
					() => assertCanBulkMove(input, ctx),
				),
			);
		}),
};
