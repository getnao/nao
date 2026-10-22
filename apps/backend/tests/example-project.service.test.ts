import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	isCloud: true,
	existsSync: vi.fn(() => true),
	listUserProjects: vi.fn(),
	getProjectById: vi.fn(),
	upsertSystemExampleProject: vi.fn(),
	upsertSystemExampleStory: vi.fn(),
	upsertSystemExampleSavedPrompts: vi.fn(),
}));

vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }));
vi.mock('../src/env', () => ({
	get isCloud() {
		return mocks.isCloud;
	},
}));
vi.mock('../src/queries/example-story.queries', () => ({
	SYSTEM_EXAMPLE_STORY_ID: 'system-example-story',
	upsertSystemExampleStory: mocks.upsertSystemExampleStory,
}));
vi.mock('../src/queries/project.queries', () => ({
	listUserProjects: mocks.listUserProjects,
	getProjectById: mocks.getProjectById,
	upsertSystemExampleProject: mocks.upsertSystemExampleProject,
}));
vi.mock('../src/queries/project-saved-prompt.queries', () => ({
	upsertSystemExampleSavedPrompts: mocks.upsertSystemExampleSavedPrompts,
}));

import { canUserAccessSystemExampleProject, ensureSystemExampleProject } from '../src/services/example-project';

describe('canUserAccessSystemExampleProject', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isCloud = true;
		mocks.getProjectById.mockResolvedValue({ id: 'system-example-project' });
	});

	it('rejects access outside cloud mode', async () => {
		mocks.isCloud = false;

		await expect(canUserAccessSystemExampleProject('user-1', 'system-example-project')).resolves.toBe(false);
		expect(mocks.getProjectById).not.toHaveBeenCalled();
	});

	it('allows a user with no real projects', async () => {
		mocks.listUserProjects.mockResolvedValue([]);

		await expect(canUserAccessSystemExampleProject('user-1', 'system-example-project')).resolves.toBe(true);
	});

	it('allows a user with a real project', async () => {
		mocks.listUserProjects.mockResolvedValue([{ id: 'real-project' }]);

		await expect(canUserAccessSystemExampleProject('user-1', 'system-example-project')).resolves.toBe(true);
	});

	it('rejects a non-example project', async () => {
		await expect(canUserAccessSystemExampleProject('user-1', 'real-project')).resolves.toBe(false);
		expect(mocks.getProjectById).not.toHaveBeenCalled();
	});
});

describe('ensureSystemExampleProject', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isCloud = true;
		mocks.upsertSystemExampleProject.mockResolvedValue({ id: 'system-example-project' });
		mocks.upsertSystemExampleStory.mockResolvedValue(undefined);
		mocks.upsertSystemExampleSavedPrompts.mockResolvedValue(undefined);
	});

	it('attempts the saved-prompt seed when the story seed fails', async () => {
		mocks.upsertSystemExampleStory.mockRejectedValue(new Error('story seed broke'));

		await expect(ensureSystemExampleProject()).rejects.toThrow('system example story failed: story seed broke');
		expect(mocks.upsertSystemExampleStory).toHaveBeenCalledOnce();
		expect(mocks.upsertSystemExampleSavedPrompts).toHaveBeenCalledOnce();
	});
});
