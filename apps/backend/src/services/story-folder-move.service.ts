import type { UserRole } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import type { DBStoryFolder } from '../db/abstractSchema';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import { assertCanShareToProject, assertCanShareWith } from './project-sharing.service';
import { assertStoryNotBeingEdited } from './story-folder-access.service';
import { getFolderViewer } from './story-folder-viewer.service';

export type FolderContext = { user: { id: string }; project: { id: string }; userRole: UserRole | null };

/** Filing a story in a folder shares it with the folder's audience, so nao and MCP clients must move it the same way. */
export async function moveStoryForUser(storyId: string, folderId: string | null, ctx: FolderContext): Promise<void> {
	const storyOwnerId = await assertCanMoveStory(storyId, ctx);
	await storyFolderQueries.moveStoryToFolder(storyId, folderId, {
		storyOwnerId,
		projectId: ctx.project.id,
		assertAllowed: async () => {
			await resolveMoveTarget(folderId, ctx, 'Folder');
			await assertCanShareWithAudience(await storyFolderQueries.resolveFolderAudience(folderId), ctx);
		},
	});
}

export async function assertFolderInProject(folderId: string, ctx: FolderContext, label = 'Folder') {
	const folder = await storyFolderQueries.getFolderById(folderId);
	if (!folder || folder.projectId !== ctx.project.id) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `${label} not found.` });
	}
	return folder;
}

export function getViewer(ctx: FolderContext) {
	return getFolderViewer(ctx.project.id, ctx.user.id, ctx.userRole);
}

/** Private folders of other users and team folders of other groups do not exist for the user. */
export async function assertCanSeeFolder(folder: DBStoryFolder, ctx: FolderContext, label = 'Folder') {
	if (!(await storyFolderQueries.canSeeFolder(folder, await getViewer(ctx)))) {
		throw new TRPCError({ code: 'NOT_FOUND', message: `${label} not found.` });
	}
}

/** Filing items in a folder shares its stories with the folder's audience, which the user must be allowed to reach. */
export async function assertCanShareWithAudience(audience: storyFolderQueries.FolderAudience, ctx: FolderContext) {
	if (audience.kind === 'project') {
		await assertCanShareToProject(ctx.project.id, ctx.user.id);
	} else if (audience.kind === 'groups') {
		await assertCanShareWith(ctx.project.id, ctx.user.id, { groupIds: audience.groupIds });
	}
}

export function assertCanPlaceInDestination(target: DBStoryFolder | null, userId: string) {
	if (target && target.visibility === 'private' && target.ownerId !== userId) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'You can only move items into your own private folder.',
		});
	}
}

export async function resolveMoveTarget(folderId: string | null, ctx: FolderContext, label = 'Target folder') {
	if (!folderId) {
		assertCanPlaceInDestination(null, ctx.user.id);
		return null;
	}
	const target = await assertFolderInProject(folderId, ctx, label);
	await assertCanSeeFolder(target, ctx, label);
	assertCanPlaceInDestination(target, ctx.user.id);
	return target;
}

export async function assertCanMoveStory(storyId: string, ctx: FolderContext): Promise<string> {
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
