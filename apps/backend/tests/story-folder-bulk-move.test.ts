import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertCanShareToProject: vi.fn(),
	getAgent: vi.fn(),
	getFolderById: vi.fn(),
	getStoryById: vi.fn(),
	getStoryOwnerId: vi.fn(),
	getStoryProjectId: vi.fn(),
	moveFolder: vi.fn(),
	moveStoryToFolder: vi.fn(),
	proposedParentChainContains: vi.fn(),
}));

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
	SystemFolderError: class extends Error {},
	getFolderById: mocks.getFolderById,
	moveFolder: mocks.moveFolder,
	moveStoryToFolder: mocks.moveStoryToFolder,
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

	it('moves every selected folder and story into the target folder', async () => {
		await createCaller().storyFolder.bulkMove({
			storyIds: ['story-a', 'story-b'],
			folderIds: ['folder-a'],
			targetFolderId: 'target',
		});

		expect(mocks.moveFolder).toHaveBeenCalledWith('user-id', 'project-id', 'folder-a', 'target');
		expect(mocks.moveStoryToFolder).toHaveBeenCalledTimes(2);
		expect(mocks.moveStoryToFolder).toHaveBeenCalledWith('story-b', 'target', {
			storyOwnerId: 'user-id',
			projectId: 'project-id',
		});
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

		expect(mocks.moveFolder).not.toHaveBeenCalled();
		expect(mocks.moveStoryToFolder).not.toHaveBeenCalled();
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

		expect(mocks.moveFolder).not.toHaveBeenCalled();
		expect(mocks.moveStoryToFolder).not.toHaveBeenCalled();
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
