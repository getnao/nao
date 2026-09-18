import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSharedStory: vi.fn(),
	getSharedChatInfo: vi.fn(),
	getDisplaySettings: vi.fn(),
	warn: vi.fn(),
}));

vi.mock('../src/queries/shared-story.queries', () => ({ getSharedStory: mocks.getSharedStory }));
vi.mock('../src/queries/shared-chat.queries', () => ({ getSharedChatInfo: mocks.getSharedChatInfo }));
vi.mock('../src/queries/project.queries', () => ({ getDisplaySettings: mocks.getDisplaySettings }));
vi.mock('../src/utils/logger', () => ({ logger: { warn: mocks.warn } }));

import { resolveLinkPreview } from '../src/services/link-preview.service';

const GENERIC_STORY_TITLE = 'A story was shared with you on nao';
const GENERIC_CHAT_TITLE = 'A conversation was shared with you on nao';

function projectShare(title: string, visibility = 'project') {
	return { title, projectId: 'project-1', visibility };
}

function linkPreviews(showSharedTitles: boolean) {
	return { linkPreviews: { showSharedTitles } };
}

describe('resolveLinkPreview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns null for routes that are not shares, without touching the database', async () => {
		expect(await resolveLinkPreview('/')).toBeNull();
		expect(await resolveLinkPreview('/settings/project/integrations?tab=nao-mcp')).toBeNull();
		expect(await resolveLinkPreview('/stories/shared/')).toBeNull();
		expect(await resolveLinkPreview('/stories/shared/abc/versions')).toBeNull();
		expect(mocks.getSharedStory).not.toHaveBeenCalled();
		expect(mocks.getSharedChatInfo).not.toHaveBeenCalled();
	});

	it('reveals the story title for project-wide shares when the project opted in', async () => {
		mocks.getSharedStory.mockResolvedValue(projectShare('Q3 churn by segment'));
		mocks.getDisplaySettings.mockResolvedValue(linkPreviews(true));

		const preview = await resolveLinkPreview('/stories/shared/share-1?utm=slack#top');

		expect(mocks.getSharedStory).toHaveBeenCalledWith('share-1');
		expect(mocks.getDisplaySettings).toHaveBeenCalledWith('project-1');
		expect(preview).toEqual({
			title: 'Q3 churn by segment',
			description: 'A story shared on nao. Sign in to view the charts and insights.',
		});
	});

	it('reveals the chat title for project-wide shares when the project opted in', async () => {
		mocks.getSharedChatInfo.mockResolvedValue(projectShare('Why did signups drop?'));
		mocks.getDisplaySettings.mockResolvedValue(linkPreviews(true));

		const preview = await resolveLinkPreview('/shared-chat/share-2/');

		expect(mocks.getSharedChatInfo).toHaveBeenCalledWith('share-2');
		expect(preview?.title).toBe('Why did signups drop?');
	});

	it('stays generic when the project has not opted in (the default)', async () => {
		mocks.getSharedStory.mockResolvedValue(projectShare('Secret board deck'));
		mocks.getDisplaySettings.mockResolvedValue(linkPreviews(false));

		const preview = await resolveLinkPreview('/stories/shared/share-1');

		expect(preview?.title).toBe(GENERIC_STORY_TITLE);
	});

	it('never reveals titles of shares restricted to specific users, even when opted in', async () => {
		mocks.getSharedChatInfo.mockResolvedValue(projectShare('Comp review', 'specific'));
		mocks.getDisplaySettings.mockResolvedValue(linkPreviews(true));

		const preview = await resolveLinkPreview('/shared-chat/share-2');

		expect(preview?.title).toBe(GENERIC_CHAT_TITLE);
		expect(mocks.getDisplaySettings).not.toHaveBeenCalled();
	});

	it('returns the same generic preview for unknown share ids so existence cannot be probed', async () => {
		mocks.getSharedStory.mockResolvedValue(null);

		const preview = await resolveLinkPreview('/stories/shared/does-not-exist');

		expect(preview?.title).toBe(GENERIC_STORY_TITLE);
		expect(mocks.getDisplaySettings).not.toHaveBeenCalled();
	});

	it('falls back to the generic preview and logs when the lookup fails', async () => {
		mocks.getSharedStory.mockRejectedValue(new Error('db down'));

		const preview = await resolveLinkPreview('/stories/shared/share-1');

		expect(preview?.title).toBe(GENERIC_STORY_TITLE);
		expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('db down'), { source: 'system' });
	});

	it('truncates very long titles', async () => {
		mocks.getSharedStory.mockResolvedValue(projectShare('x'.repeat(300)));
		mocks.getDisplaySettings.mockResolvedValue(linkPreviews(true));

		const preview = await resolveLinkPreview('/stories/shared/share-1');

		expect(preview?.title).toHaveLength(120);
		expect(preview?.title.endsWith('…')).toBe(true);
	});

	it('decodes percent-encoded share ids and tolerates malformed encodings', async () => {
		mocks.getSharedStory.mockResolvedValue(null);

		await resolveLinkPreview('/stories/shared/share%201');
		await resolveLinkPreview('/stories/shared/bad%zz');

		expect(mocks.getSharedStory).toHaveBeenNthCalledWith(1, 'share 1');
		expect(mocks.getSharedStory).toHaveBeenNthCalledWith(2, 'bad%zz');
	});
});
