import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	existsSync: vi.fn(() => true),
	upsertSystemExampleProject: vi.fn(),
	upsertSystemExampleStory: vi.fn(),
	upsertSavedPrompts: vi.fn(),
}));

vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }));
vi.mock('../src/env', () => ({ isCloud: true }));
vi.mock('../src/queries/example-story.queries', () => ({
	upsertSystemExampleStory: mocks.upsertSystemExampleStory,
}));
vi.mock('../src/queries/project.queries', () => ({
	upsertSystemExampleProject: mocks.upsertSystemExampleProject,
}));
vi.mock('../src/queries/project-saved-prompt.queries', () => ({
	upsertSavedPrompts: mocks.upsertSavedPrompts,
}));

import { JAFFLE_SHOP_SAVED_PROMPTS } from '../src/fixtures/jaffle-shop-saved-prompts';
import { ensureSystemExampleProject } from '../src/services/example-project';

describe('ensureSystemExampleProject', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.upsertSystemExampleProject.mockResolvedValue({ id: 'system-example-project' });
	});

	it('seeds the Jaffle Shop story and saved prompts', async () => {
		await ensureSystemExampleProject();

		expect(mocks.upsertSystemExampleStory).toHaveBeenCalledOnce();
		expect(mocks.upsertSavedPrompts).toHaveBeenCalledWith(JAFFLE_SHOP_SAVED_PROMPTS);
	});
});
