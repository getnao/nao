import type { FolderVisibility, UserRole } from '@nao/shared/types';

import type { DBStoryFolder } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';

export type StoryFolderTargetErrorCode = 'forbidden' | 'not_found';

export class StoryFolderTargetError extends Error {
	constructor(
		public readonly code: StoryFolderTargetErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'StoryFolderTargetError';
	}
}

export interface StoryFolderTargetContext {
	userId: string;
	projectId: string;
}

export interface StoryFolderTarget {
	id: string;
	name: string;
	parentId: string | null;
	ownerId: string | null;
	visibility: FolderVisibility;
	systemType: string | null;
	storyCount: number;
}

interface StoryFolderTargetDependencies {
	getUserRoleInProject(projectId: string, userId: string): Promise<UserRole | null>;
	ensurePrivateRoot(userId: string, projectId: string): Promise<string>;
	listFolderTree(
		userId: string,
		projectId: string,
		options: { isViewer: boolean },
	): Promise<storyFolderQueries.FolderTreeEntry[]>;
	getFolderById(id: string): Promise<DBStoryFolder | null>;
	createFolder(data: {
		ownerId: string;
		projectId: string;
		name: string;
		parentId: string | null;
	}): Promise<DBStoryFolder>;
	getStoryProjectId(storyId: string): Promise<string | null>;
	getStoryOwnerId(storyId: string): Promise<string | undefined>;
	moveStoryToFolder(
		storyId: string,
		folderId: string | null,
		options: { storyOwnerId: string; projectId: string },
	): Promise<void>;
}

const DEFAULT_DEPENDENCIES: StoryFolderTargetDependencies = {
	getUserRoleInProject: projectQueries.getUserRoleInProject,
	ensurePrivateRoot: storyFolderQueries.ensurePrivateRoot,
	listFolderTree: storyFolderQueries.listFolderTree,
	getFolderById: storyFolderQueries.getFolderById,
	createFolder: storyFolderQueries.createFolder,
	getStoryProjectId: storyQueries.getStoryProjectId,
	getStoryOwnerId: storyQueries.getStoryOwnerId,
	moveStoryToFolder: storyFolderQueries.moveStoryToFolder,
};

export class StoryFolderTargetService {
	constructor(private readonly dependencies: StoryFolderTargetDependencies = DEFAULT_DEPENDENCIES) {}

	async listFolders(context: StoryFolderTargetContext): Promise<StoryFolderTarget[]> {
		const role = await this.requireProjectRole(context);
		const isViewer = role === 'viewer';
		if (!isViewer) {
			await this.dependencies.ensurePrivateRoot(context.userId, context.projectId);
		}
		const folders = await this.dependencies.listFolderTree(context.userId, context.projectId, { isViewer });
		return folders.map((folder) => toTargetFolder(folder, folder.storyCount));
	}

	async createFolder(
		context: StoryFolderTargetContext,
		input: { name: string; parentId?: string | null },
	): Promise<StoryFolderTarget> {
		await this.requireCanSend(context);
		const parentId =
			input.parentId === undefined
				? await this.dependencies.ensurePrivateRoot(context.userId, context.projectId)
				: input.parentId;
		if (parentId) {
			await this.getAccessibleFolder(context, parentId, 'Parent folder');
		}
		const folder = await this.dependencies.createFolder({
			ownerId: context.userId,
			projectId: context.projectId,
			name: input.name,
			parentId,
		});
		return toTargetFolder(folder, 0);
	}

	async moveStory(
		context: StoryFolderTargetContext,
		input: { storyId: string; folderId: string | null },
	): Promise<{ storyId: string; folderId: string | null }> {
		const role = await this.requireCanSend(context);
		const storyProjectId = await this.dependencies.getStoryProjectId(input.storyId);
		if (storyProjectId !== context.projectId) {
			throw new StoryFolderTargetError('not_found', 'Story not found in this project.');
		}
		const storyOwnerId = await this.dependencies.getStoryOwnerId(input.storyId);
		if (!storyOwnerId) {
			throw new StoryFolderTargetError('not_found', 'Story not found.');
		}
		if (storyOwnerId !== context.userId && role !== 'admin') {
			throw new StoryFolderTargetError('forbidden', 'Only the owner or an admin can move this story.');
		}
		if (input.folderId) {
			await this.getAccessibleFolder(context, input.folderId, 'Target folder');
		}
		await this.dependencies.moveStoryToFolder(input.storyId, input.folderId, {
			storyOwnerId,
			projectId: context.projectId,
		});
		return input;
	}

	private async requireProjectRole(context: StoryFolderTargetContext): Promise<UserRole> {
		const role = await this.dependencies.getUserRoleInProject(context.projectId, context.userId);
		if (!role) {
			throw new StoryFolderTargetError('forbidden', 'User is not a member of this project.');
		}
		return role;
	}

	private async requireCanSend(context: StoryFolderTargetContext): Promise<UserRole> {
		const role = await this.requireProjectRole(context);
		if (role === 'viewer') {
			throw new StoryFolderTargetError('forbidden', 'Viewers cannot modify story folders.');
		}
		return role;
	}

	private async getAccessibleFolder(
		context: StoryFolderTargetContext,
		folderId: string,
		label: string,
	): Promise<DBStoryFolder> {
		const folder = await this.dependencies.getFolderById(folderId);
		if (
			!folder ||
			folder.projectId !== context.projectId ||
			(folder.visibility === 'private' && folder.ownerId !== context.userId)
		) {
			throw new StoryFolderTargetError('not_found', `${label} not found.`);
		}
		return folder;
	}
}

function toTargetFolder(
	folder: Pick<StoryFolderTarget, 'id' | 'name' | 'parentId' | 'ownerId' | 'visibility' | 'systemType'>,
	storyCount: number,
): StoryFolderTarget {
	return {
		id: folder.id,
		name: folder.name,
		parentId: folder.parentId,
		ownerId: folder.ownerId,
		visibility: folder.visibility,
		systemType: folder.systemType,
		storyCount,
	};
}

export const storyFolderTargetService = new StoryFolderTargetService();
