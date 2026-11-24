import { BULK_ITEMS_LIMIT } from '@nao/shared';
import type { UserRole } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import type { DBStoryFolder } from '../db/abstractSchema';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { agentService } from '../services/agent';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { assertCanShareToProject, assertCanShareWith } from '../services/project-sharing.service';
import { assertShareableUserGroupIds } from '../services/shareable-user-groups.service';
import { getFolderAccess } from '../services/story-folder-access.service';
import { getFolderViewer } from '../services/story-folder-viewer.service';
import { canSendProcedure, projectProtectedProcedure } from './trpc';

type FolderContext = { user: { id: string }; project: { id: string }; userRole: UserRole | null };

async function assertFolderInProject(folderId: string, ctx: FolderContext, label = 'Folder') {
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

async function assertCanModifyFolders(folderIds: string[], ctx: FolderContext) {
	for (const folderId of folderIds) {
		const folder = await assertFolderInProject(folderId, ctx);
		await assertCanSeeFolder(folder, ctx);
		assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);
	}
}

function getViewer(ctx: FolderContext) {
	return getFolderViewer(ctx.project.id, ctx.user.id, ctx.userRole);
}

/** Private folders of other users and team folders of other groups do not exist for the user. */
async function assertCanSeeFolder(folder: DBStoryFolder, ctx: FolderContext, label = 'Folder') {
	if (!(await storyFolderQueries.canSeeFolder(folder, await getViewer(ctx)))) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `${label} not found.` });
	}
}

/** Filing items in a folder shares its stories with the folder's audience, which the user must be allowed to reach. */
async function assertCanShareWithAudience(audience: storyFolderQueries.FolderAudience, ctx: FolderContext) {
	if (audience.kind === 'project') {
		await assertCanShareToProject(ctx.project.id, ctx.user.id);
	} else if (audience.kind === 'groups') {
		await assertCanShareWith(ctx.project.id, ctx.user.id, { groupIds: audience.groupIds });
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

function assertCanPlaceInDestination(target: DBStoryFolder | null, userId: string) {
	if (target && target.visibility === 'private' && target.ownerId !== userId) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'You can only move items into your own private folder.',
		});
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

async function assertStoryNotBeingEdited(storyId: string) {
	const story = await storyQueries.getStoryById(storyId);
	if (story?.chatId && agentService.get(story.chatId)) {
		throw new TRPCError({
			code: 'CONFLICT',
			message: 'The agent is working on this story. Move it once it is done.',
		});
	}
}

async function resolveMoveTarget(folderId: string | null, ctx: FolderContext, label = 'Target folder') {
	if (!folderId) {
		assertCanPlaceInDestination(null, ctx.user.id);
		return null;
	}
	const target = await assertFolderInProject(folderId, ctx, label);
	await assertCanSeeFolder(target, ctx, label);
	assertCanPlaceInDestination(target, ctx.user.id);
	return target;
}

async function assertCanMoveFolder(folderId: string, target: DBStoryFolder | null, ctx: FolderContext) {
	const folder = await assertFolderInProject(folderId, ctx);
	await assertCanSeeFolder(folder, ctx);
	assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);
	assertCanChangeFolderScope(folder, target, ctx.user.id);
	return folder;
}

async function assertCanMoveStory(storyId: string, ctx: FolderContext): Promise<string> {
	const storyProjectId = await storyQueries.getStoryProjectId(storyId);
	if (storyProjectId !== ctx.project.id) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found in this project.' });
	}

	const storyOwnerId = await storyQueries.getStoryOwnerId(storyId);
	if (!storyOwnerId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}

	if (storyOwnerId !== ctx.user.id && ctx.userRole !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner or an admin can move this story.' });
	}

	await assertStoryNotBeingEdited(storyId);
	return storyOwnerId;
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
			let parent: DBStoryFolder | null = null;
			if (input.parentId) {
				parent = await assertFolderInProject(input.parentId, ctx, 'Parent folder');
				await assertCanSeeFolder(parent, ctx, 'Parent folder');
			}
			assertCanPlaceInDestination(parent, ctx.user.id);
			await assertCanCreateTeamFolder(input.groupIds, ctx);
			return runFolderMove(() =>
				storyFolderQueries.createFolder({
					ownerId: ctx.user.id,
					projectId: ctx.project.id,
					name: input.name,
					parentId: input.parentId ?? null,
					groupIds: input.groupIds,
				}),
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
			const folder = await assertFolderInProject(input.id, ctx);
			await assertCanSeeFolder(folder, ctx);
			assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);
			await storyFolderQueries.updateFolder(input.id, { name: input.name });
		}),

	delete: canSendProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const folder = await assertFolderInProject(input.id, ctx);
		await assertCanSeeFolder(folder, ctx);
		assertCanModifyFolder(folder, ctx.user.id, ctx.userRole);
		await storyFolderQueries.deleteFolderMovingContentsToParent(input.id);
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
			const storyOwnerId = await assertCanMoveStory(input.storyId, ctx);
			await storyFolderQueries.moveStoryToFolder(input.storyId, input.folderId, {
				storyOwnerId,
				projectId: ctx.project.id,
				assertAllowed: async () => {
					await resolveMoveTarget(input.folderId, ctx, 'Folder');
					await assertCanShareWithAudience(
						await storyFolderQueries.resolveFolderAudience(input.folderId),
						ctx,
					);
				},
			});
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
