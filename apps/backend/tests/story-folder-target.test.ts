import type { MetabaseCollection } from '@nao/shared/metabase-migration';
import type { UserRole } from '@nao/shared/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import type { DBStoryFolder } from '../src/db/abstractSchema';
import { StoryFolderTargetService } from '../src/services/story-folder-target';

const context = { userId: 'user-1', projectId: 'project-1' };

const folder = (overrides: Partial<DBStoryFolder> = {}): DBStoryFolder => ({
	id: 'folder-1',
	ownerId: 'user-1',
	projectId: 'project-1',
	parentId: null,
	name: 'Ecommerce',
	visibility: 'private',
	systemType: null,
	archivedAt: null,
	createdAt: new Date('2026-01-01T00:00:00Z'),
	updatedAt: new Date('2026-01-01T00:00:00Z'),
	...overrides,
});

const collections: MetabaseCollection[] = [
	{ id: 1, name: 'Analytics', description: null, parentId: null, archived: false },
	{ id: 2, name: 'Ecommerce', description: null, parentId: 1, archived: false },
];

const createDependencies = () => ({
	getUserRoleInProject: vi.fn(async (_projectId: string, _userId: string): Promise<UserRole | null> => 'user'),
	ensurePrivateRoot: vi.fn(async (_userId: string, _projectId: string) => 'private-root'),
	listFolderTree: vi.fn(async (_userId: string, _projectId: string, _options: { isViewer: boolean }) => [
		{ ...folder(), storyCount: 2 },
	]),
	getFolderById: vi.fn(async (_id: string) => folder()),
	createFolder: vi.fn(async (_data: { ownerId: string; projectId: string; name: string; parentId: string | null }) =>
		folder(),
	),
	getStoryProjectId: vi.fn(async (_storyId: string) => 'project-1'),
	getStoryOwnerId: vi.fn(async (_storyId: string) => 'user-1'),
	moveStoryToFolder: vi.fn(
		async (_storyId: string, _folderId: string | null, _options: { storyOwnerId: string; projectId: string }) => {},
	),
});

describe('story folder target service', () => {
	it('lists visible folders and initializes the caller private root', async () => {
		const dependencies = createDependencies();
		const service = new StoryFolderTargetService(dependencies);

		await expect(service.listFolders(context)).resolves.toEqual([
			{
				id: 'folder-1',
				name: 'Ecommerce',
				parentId: null,
				ownerId: 'user-1',
				visibility: 'private',
				systemType: null,
				storyCount: 2,
			},
		]);
		expect(dependencies.ensurePrivateRoot).toHaveBeenCalledWith('user-1', 'project-1');
		expect(dependencies.listFolderTree).toHaveBeenCalledWith('user-1', 'project-1', { isViewer: false });
	});

	it('keeps viewer folder listing read-only', async () => {
		const dependencies = createDependencies();
		dependencies.getUserRoleInProject.mockResolvedValue('viewer');
		const service = new StoryFolderTargetService(dependencies);

		await service.listFolders(context);
		expect(dependencies.ensurePrivateRoot).not.toHaveBeenCalled();
		expect(dependencies.listFolderTree).toHaveBeenCalledWith('user-1', 'project-1', { isViewer: true });
		await expect(service.createFolder(context, { name: 'Blocked' })).rejects.toMatchObject({
			code: 'forbidden',
		});
	});

	it('creates explicit folders without silently reusing duplicate names', async () => {
		const dependencies = createDependencies();
		dependencies.createFolder
			.mockResolvedValueOnce(folder({ id: 'folder-1' }))
			.mockResolvedValueOnce(folder({ id: 'folder-2' }));
		const service = new StoryFolderTargetService(dependencies);

		await expect(service.createFolder(context, { name: 'Ecommerce' })).resolves.toMatchObject({
			id: 'folder-1',
		});
		await expect(service.createFolder(context, { name: 'Ecommerce' })).resolves.toMatchObject({
			id: 'folder-2',
		});
		expect(dependencies.createFolder).toHaveBeenCalledTimes(2);
	});

	it('creates a missing collection folder path and reuses existing ancestors', async () => {
		const dependencies = createDependencies();
		dependencies.listFolderTree.mockResolvedValue([
			{ ...folder({ id: 'analytics', name: 'Analytics', visibility: 'public' }), storyCount: 0 },
		]);
		dependencies.createFolder.mockImplementation(async (data) =>
			folder({ id: 'ecommerce', name: data.name, parentId: data.parentId, visibility: 'public' }),
		);
		const service = new StoryFolderTargetService(dependencies);

		await expect(service.ensureCollectionFolderPath(context, collections, 2)).resolves.toBe('ecommerce');
		expect(dependencies.createFolder).toHaveBeenCalledOnce();
		expect(dependencies.createFolder).toHaveBeenCalledWith({
			ownerId: 'user-1',
			projectId: 'project-1',
			name: 'Ecommerce',
			parentId: 'analytics',
		});
	});

	it('rejects ambiguous or incomplete collection folder paths', async () => {
		const dependencies = createDependencies();
		dependencies.listFolderTree.mockResolvedValue([
			{ ...folder({ id: 'analytics-1', name: 'Analytics', visibility: 'public' }), storyCount: 0 },
			{ ...folder({ id: 'analytics-2', name: 'Analytics', visibility: 'public' }), storyCount: 0 },
		]);
		const service = new StoryFolderTargetService(dependencies);

		await expect(service.ensureCollectionFolderPath(context, collections, 2)).rejects.toMatchObject({
			code: 'ambiguous',
		});
		await expect(service.ensureCollectionFolderPath(context, [collections[1]], 2)).rejects.toMatchObject({
			code: 'invalid_collection_path',
		});
		expect(dependencies.createFolder).not.toHaveBeenCalled();
	});

	it('does not expose cross-project or foreign private parent folders', async () => {
		const dependencies = createDependencies();
		const service = new StoryFolderTargetService(dependencies);

		dependencies.getFolderById.mockResolvedValueOnce(folder({ projectId: 'other-project' }));
		await expect(service.createFolder(context, { name: 'Nested', parentId: 'other-folder' })).rejects.toMatchObject(
			{
				code: 'not_found',
			},
		);

		dependencies.getFolderById.mockResolvedValueOnce(folder({ ownerId: 'other-user' }));
		await expect(
			service.createFolder(context, { name: 'Nested', parentId: 'private-folder' }),
		).rejects.toMatchObject({
			code: 'not_found',
		});
		expect(dependencies.createFolder).not.toHaveBeenCalled();
	});

	it('enforces project, ownership, and destination checks when moving a story', async () => {
		const dependencies = createDependencies();
		const service = new StoryFolderTargetService(dependencies);

		dependencies.getStoryProjectId.mockResolvedValueOnce('other-project');
		await expect(service.moveStory(context, { storyId: 'story-1', folderId: null })).rejects.toMatchObject({
			code: 'not_found',
		});

		dependencies.getStoryOwnerId.mockResolvedValue('other-user');
		await expect(service.moveStory(context, { storyId: 'story-1', folderId: null })).rejects.toMatchObject({
			code: 'forbidden',
		});

		dependencies.getUserRoleInProject.mockResolvedValue('admin');
		dependencies.getFolderById.mockResolvedValue(
			folder({ id: 'public-folder', ownerId: 'other-user', visibility: 'public' }),
		);
		await expect(service.moveStory(context, { storyId: 'story-1', folderId: 'public-folder' })).resolves.toEqual({
			storyId: 'story-1',
			folderId: 'public-folder',
		});
		expect(dependencies.moveStoryToFolder).toHaveBeenCalledWith('story-1', 'public-folder', {
			storyOwnerId: 'other-user',
			projectId: 'project-1',
		});
	});
});
