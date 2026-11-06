import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertCanShareToProject: vi.fn(),
	getAgent: vi.fn(),
	getFolderById: vi.fn(),
	getStoryById: vi.fn(),
	getStoryOwnerId: vi.fn(),
	getStoryProjectId: vi.fn(),
	moveItemsToFolder: vi.fn(),
	proposedParentChainContains: vi.fn(),
}));

const SystemFolderError = vi.hoisted(
	() =>
		class extends Error {
			constructor() {
				super('System folders cannot be modified.');
			}
		},
);

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', name: 'Project', orgId: 'org-id' })),
	getUserRoleInProject: vi.fn(async () => 'user'),
}));
vi.mock('../src/queries/story.queries', () => ({
	getStoryById: mocks.getStoryById,
	getStoryOwnerId: mocks.getStoryOwnerId,
	getStoryProjectId: mocks.getStoryProjectId,
}));
vi.mock('../src/queries/story-folder.queries', () => ({
	MoveFolderCycleError: class extends Error {
		constructor() {
			super('Moving this folder would create a cycle.');
		}
	},
	SystemFolderError,
	getFolderById: mocks.getFolderById,
	moveItemsToFolder: mocks.moveItemsToFolder,
	proposedParentChainContains: mocks.proposedParentChainContains,
}));
vi.mock('../src/services/agent', () => ({ agentService: { get: mocks.getAgent } }));
vi.mock('../src/services/project-sharing.service', () => ({
	assertCanShareToProject: mocks.assertCanShareToProject,
}));

import { storyFolderRoutes } from '../src/trpc/story-folder.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ storyFolder: storyFolderRoutes });

describe('storyFolder.bulkMove', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getFolderById.mockImplementation(async (id: string) => buildFolder(id));
		mocks.getStoryProjectId.mockResolvedValue('project-id');
		mocks.getStoryOwnerId.mockResolvedValue('user-id');
		mocks.getStoryById.mockImplementation(async (id: string) => ({ id, chatId: `chat-${id}` }));
		mocks.getAgent.mockReturnValue(undefined);
		mocks.proposedParentChainContains.mockResolvedValue(false);
	});

	it('moves every selected folder and story into the target folder in one batch', async () => {
		await createCaller().storyFolder.bulkMove({
			storyIds: ['story-a', 'story-b'],
			folderIds: ['folder-a'],
			targetFolderId: 'target',
		});

		expect(mocks.moveItemsToFolder).toHaveBeenCalledTimes(1);
		expect(mocks.moveItemsToFolder).toHaveBeenCalledWith(
			'user-id',
			'project-id',
			{
				folderIds: ['folder-a'],
				stories: [
					{ storyId: 'story-a', storyOwnerId: 'user-id' },
					{ storyId: 'story-b', storyOwnerId: 'user-id' },
				],
			},
			'target',
		);
	});

	it('moves nothing when the target sits inside a selected folder', async () => {
		mocks.proposedParentChainContains.mockImplementation(
			async (_targetId: string, folderId: string) => folderId === 'folder-b',
		);

		await expect(
			createCaller().storyFolder.bulkMove({
				storyIds: ['story-a'],
				folderIds: ['folder-a', 'folder-b'],
				targetFolderId: 'target',
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });

		expect(mocks.moveItemsToFolder).not.toHaveBeenCalled();
	});

	it('moves nothing when the agent is editing a selected story', async () => {
		mocks.getAgent.mockImplementation((chatId: string) => (chatId === 'chat-story-b' ? {} : undefined));

		await expect(
			createCaller().storyFolder.bulkMove({
				storyIds: ['story-a', 'story-b'],
				folderIds: ['folder-a'],
				targetFolderId: 'target',
			}),
		).rejects.toMatchObject({ code: 'CONFLICT' });

		expect(mocks.moveItemsToFolder).not.toHaveBeenCalled();
	});

	it('reports a system folder in the selection as forbidden', async () => {
		mocks.moveItemsToFolder.mockRejectedValue(new SystemFolderError());

		await expect(
			createCaller().storyFolder.bulkMove({
				storyIds: [],
				folderIds: ['folder-a', 'private-root'],
				targetFolderId: null,
			}),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});

	it('rejects an empty selection', async () => {
		await expect(
			createCaller().storyFolder.bulkMove({ storyIds: [], folderIds: [], targetFolderId: null }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});
});

function buildFolder(id: string) {
	return { id, projectId: 'project-id', ownerId: 'user-id', visibility: 'public', systemType: null };
}

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', name: 'Test User', email: 'test@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
