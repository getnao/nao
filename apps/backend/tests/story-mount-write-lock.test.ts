import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import { writeStoryMountFile } from '../src/services/story-mount';

const STORY = { id: 'story-1', chatId: 'chat-1', slug: 'revenue', format: 'custom' };
const SCOPE = { userId: 'editor-1', chatId: 'agent-chat-1', projectId: 'project-1' };

const mocks = vi.hoisted(() => ({
	heldLocks: new Set<string>(),
	refuseNextValidation: { promise: null as Promise<void> | null },
	writeDraftFile: vi.fn(async (_storyId: string, file: { path: string; content: string }) => file),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/services/editable-story', () => ({
	findEditableStory: async () => ({ story: STORY }),
}));
vi.mock('../src/utils/story-file-format', () => ({
	formatStoryFile: async (_path: string, content: string) => content,
}));
vi.mock('../src/queries/story-file.queries', () => ({ writeDraftFile: mocks.writeDraftFile }));
vi.mock('../src/services/custom-story-query-access', () => ({
	assertWriterAddsNoChatQueries: async (_story: unknown, _writerId: string, files: { content: string }[]) => {
		if (files[0].content === 'refused') {
			await new Promise((resolve) => setTimeout(resolve, 20));
			throw new Error('Query query_private is not part of this story.');
		}
	},
}));
vi.mock('../src/services/story-edit-lock.service', () => ({
	getStoryEditLockState: async (storyId: string) =>
		mocks.heldLocks.has(storyId) ? { holderName: 'Editor', isMine: true, isYou: true, byAgent: true } : null,
	acquireStoryEditLock: async (storyId: string) => {
		mocks.heldLocks.add(storyId);
	},
	releaseStoryEditLock: async (storyId: string) => {
		mocks.heldLocks.delete(storyId);
	},
}));

describe('writing story files in parallel from the same agent', () => {
	beforeAll(() => {
		process.env.BETA_CUSTOM_STORIES_ENABLED = 'true';
		__reloadEnvForTesting();
	});

	afterAll(() => {
		delete process.env.BETA_CUSTOM_STORIES_ENABLED;
		__reloadEnvForTesting();
	});

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
