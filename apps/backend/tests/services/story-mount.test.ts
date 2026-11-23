import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../../src/env';
import { listStoryMount, readStoryMountFile, writeStoryMountFile } from '../../src/services/story-mount';

const STORY = { id: 'story-1', chatId: 'chat-1', slug: 'revenue', format: 'custom' };
const SCOPE = { userId: 'editor-1', chatId: 'agent-chat-1', projectId: 'project-1' };

const mocks = vi.hoisted(() => ({
	heldLocks: new Set<string>(),
	refuseNextValidation: { promise: null as Promise<void> | null },
	writeDraftFile: vi.fn(async (_storyId: string, file: { path: string; content: string }) => file),
	countStoryLogs: vi.fn(async () => 0),
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/services/editable-story', () => ({
	findEditableStory: async () => ({ story: STORY }),
}));
vi.mock('../../src/utils/story-file-format', () => ({
	formatStoryFile: async (_path: string, content: string) => content,
}));
vi.mock('../../src/queries/story-file.queries', () => ({
	writeDraftFile: mocks.writeDraftFile,
	listDraftFiles: async () => [{ path: 'app.jsx', content: 'export default App;' }],
}));
vi.mock('../../src/services/story-log', () => ({
	countStoryLogs: mocks.countStoryLogs,
	renderStoryLogs: async () => '[sql] v2 · seen once · last 2026-11-23T10:00:00.000Z',
}));
vi.mock('../../src/services/custom-story-query-access', () => ({
	assertWriterAddsNoChatQueries: async (_story: unknown, _writerId: string, files: { content: string }[]) => {
		if (files[0].content === 'refused') {
			await new Promise((resolve) => setTimeout(resolve, 20));
			throw new Error('Query query_private is not part of this story.');
		}
	},
}));
vi.mock('../../src/services/story-edit-lock.service', () => ({
	getStoryEditLockState: async (storyId: string) =>
		mocks.heldLocks.has(storyId) ? { holderName: 'Editor', isMine: true, isYou: true, byAgent: true } : null,
	acquireStoryEditLock: async (storyId: string) => {
		mocks.heldLocks.add(storyId);
	},
	releaseStoryEditLock: async (storyId: string) => {
		mocks.heldLocks.delete(storyId);
	},
}));

beforeAll(() => {
	process.env.BETA_CUSTOM_STORIES_ENABLED = 'true';
	__reloadEnvForTesting();
});

afterAll(() => {
	delete process.env.BETA_CUSTOM_STORIES_ENABLED;
	__reloadEnvForTesting();
});

describe('writing story files in parallel from the same agent', () => {
	it('keeps the lock for the write that succeeds when the other one is refused', async () => {
		const [refused, accepted] = await Promise.allSettled([
			writeStoryMountFile(SCOPE, `/stories/${STORY.id}/app.jsx`, 'refused'),
			writeStoryMountFile(SCOPE, `/stories/${STORY.id}/lib/format.js`, 'accepted'),
		]);

		expect(refused.status).toBe('rejected');
		expect(accepted.status).toBe('fulfilled');
		expect(mocks.heldLocks.has(STORY.id)).toBe(true);
	});
});

describe('the @logs file of a custom story', () => {
	it('shows in the story folder only once something failed', async () => {
		expect((await listStoryMount(SCOPE, `/stories/${STORY.id}`)).map((entry) => entry.name)).toEqual(['app.jsx']);

		mocks.countStoryLogs.mockResolvedValueOnce(2);

		expect(await listStoryMount(SCOPE, `/stories/${STORY.id}`)).toEqual([
			expect.objectContaining({ name: 'app.jsx' }),
			expect.objectContaining({ path: `/stories/${STORY.id}/@logs`, name: '@logs', type: 'file' }),
		]);
	});

	it('reads the logged failures but cannot be written', async () => {
		expect(await readStoryMountFile(SCOPE, `/stories/${STORY.id}/@logs`)).toContain('[sql] v2 · seen once');
		await expect(writeStoryMountFile(SCOPE, `/stories/${STORY.id}/@logs`, 'cleared')).rejects.toThrow(
			/is read-only/,
		);
	});
});
