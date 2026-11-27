import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SharedStoryWithLatest } from '../../src/queries/shared-story.queries';

const mocks = vi.hoisted(() => ({
	hasEffectiveWarehouseRestrictions: vi.fn(),
	withKpiPreviewData: vi.fn(),
}));

vi.mock('../../src/queries/shared-story.queries', () => ({}));
vi.mock('../../src/queries/story.queries', () => ({}));
vi.mock('../../src/queries/story-folder.queries', () => ({}));
vi.mock('../../src/services/story-delivery.service', () => ({ teardownStoryDelivery: vi.fn() }));
vi.mock('../../src/services/user-group-context-access.service', () => ({
	hasEffectiveWarehouseRestrictions: mocks.hasEffectiveWarehouseRestrictions,
}));
vi.mock('../../src/utils/story-query-data', () => ({ withKpiPreviewData: mocks.withKpiPreviewData }));

import { listSharedStoriesForViewer } from '../../src/services/shared-story.service';

const OWNER_CODE = [
	'## EMEA revenue hit 5M',
	'EMEA grew fastest this quarter.',
	'<chart query_id="q_revenue" title="EMEA revenue" />',
].join('\n');

describe('listSharedStoriesForViewer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.withKpiPreviewData.mockImplementation(async (stories: { storyId: string }[]) =>
			stories.map((story) => ({ ...story, kpiPreviewData: { preview: story.storyId } })),
		);
	});

	it('lists every story with its owner copy to a viewer without restrictions', async () => {
		mocks.hasEffectiveWarehouseRestrictions.mockResolvedValue(false);

		const stories = await listSharedStoriesForViewer(
			[sharedStory({ storyId: 'chat-story' }), sharedStory({ storyId: 'standalone-story', chatId: null })],
			'project-1',
			'viewer-1',
		);

		expect(stories.map((story) => story.storyId)).toEqual(['chat-story', 'standalone-story']);
		expect(stories[0]).toMatchObject({
			code: OWNER_CODE,
			canShowThumbnail: true,
			kpiPreviewData: { preview: 'chat-story' },
		});
		expect(stories[0]).not.toHaveProperty('ownerUserId');
	});

	it('gives a restricted viewer none of the copy built from the rows of another owner', async () => {
		mocks.hasEffectiveWarehouseRestrictions.mockResolvedValue(true);

		const [story] = await listSharedStoriesForViewer(
			[sharedStory({ storyId: 'chat-story' })],
			'project-1',
			'viewer-1',
		);

		expect(story).toMatchObject({
			code: '<chart query_id="q_revenue" />',
			canShowThumbnail: false,
			kpiPreviewData: null,
		});
		expect(JSON.stringify(story.summary)).not.toContain('EMEA');
		expect(mocks.withKpiPreviewData).toHaveBeenCalledWith([], expect.any(Function));
	});

	it('hides standalone stories of other owners from a restricted viewer and keeps their own untouched', async () => {
		mocks.hasEffectiveWarehouseRestrictions.mockResolvedValue(true);

		const stories = await listSharedStoriesForViewer(
			[
				sharedStory({ storyId: 'foreign-standalone', chatId: null }),
				sharedStory({ storyId: 'own-standalone', chatId: null, ownerUserId: 'viewer-1' }),
			],
			'project-1',
			'viewer-1',
		);

		expect(stories).toHaveLength(1);
		expect(stories[0]).toMatchObject({
			storyId: 'own-standalone',
			code: OWNER_CODE,
			canShowThumbnail: true,
			kpiPreviewData: { preview: 'own-standalone' },
		});
	});
});

function sharedStory(overrides: Partial<SharedStoryWithLatest>): SharedStoryWithLatest {
	return {
		id: 'share-1',
		storyId: 'story-1',
		projectId: 'project-1',
		userId: 'owner-1',
		ownerUserId: 'owner-1',
		chatId: 'chat-1',
		slug: 'revenue',
		title: 'Revenue',
		code: OWNER_CODE,
		format: 'classic',
		version: 1,
		visibility: 'project',
		sharedWithCount: 0,
		sharedWithGroupCount: 0,
		isPinned: false,
		...overrides,
	} as SharedStoryWithLatest;
}
