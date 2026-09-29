import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listStoryMountFilesToGrep } from '../src/services/story-mount';

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/env', async (importOriginal) => ({
	env: { ...(await importOriginal<typeof import('../src/env')>()).env, BETA_CUSTOM_STORIES_ENABLED: true },
}));

const story = { id: 'story-1', chatId: 'chat-1', slug: 'revenue', format: 'custom' };

vi.mock('../src/queries/story.queries', () => ({
	getStoryByChatAndSlug: async () => story,
	listCustomStoriesInChat: async () => [story],
	getVersionByNumber: async (_chatId: string, _slug: string, versionNumber: number) =>
		versionNumber === 2 ? { id: 'version-2', version: 2 } : null,
}));

vi.mock('../src/queries/story-file.queries', () => ({
	listDraftFiles: async () => [{ path: 'app.jsx', content: 'draft' }],
	listVersionFiles: async () => [{ path: 'app.jsx', content: 'published' }],
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe('listStoryMountFilesToGrep', () => {
	it('searches the drafts of a story', async () => {
		expect(await listStoryMountFilesToGrep('chat-1', '/stories/revenue', undefined)).toEqual([
			{ virtualPath: '/stories/revenue/app.jsx', content: 'draft' },
		]);
	});

	it('searches a published version when the scope is under @vN', async () => {
		expect(await listStoryMountFilesToGrep('chat-1', '/stories/revenue/@v2', undefined)).toEqual([
			{ virtualPath: '/stories/revenue/@v2/app.jsx', content: 'published' },
		]);
	});

	it('narrows a published version scope to one file', async () => {
		expect(await listStoryMountFilesToGrep('chat-1', '/stories/revenue/@v2/app.jsx', undefined)).toHaveLength(1);
	});

	it('fails on a version that was never published', async () => {
		await expect(listStoryMountFilesToGrep('chat-1', '/stories/revenue/@v9', undefined)).rejects.toThrow(
			'no published version 9',
		);
	});
});
