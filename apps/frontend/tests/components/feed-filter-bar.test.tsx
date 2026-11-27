import { describe, expect, it, vi } from 'vitest';

import type { NotificationFeedItem } from '@/components/automations-feed';
import type { FeedFilters } from '@/components/feed-filter-bar';
import { applyFeedFilters } from '@/components/feed-filter-bar';

vi.mock('@/main', () => ({ trpc: {} }));

const UNREAD_ONLY: FeedFilters = { types: [], actors: [], readStatus: 'unread', sort: 'newest' };

describe('applyFeedFilters', () => {
	it.each([
		{ keptItemIds: new Set<string>(), expectedIds: ['unread'] },
		{ keptItemIds: new Set(['read']), expectedIds: ['unread', 'read'] },
	])('keeps only unread items, plus the kept ones $keptItemIds', ({ keptItemIds, expectedIds }) => {
		const items = [notification('unread', null), notification('read', '2026-11-05T11:00:00Z')];

		const displayed = applyFeedFilters(items, UNREAD_ONLY, null, keptItemIds);

		expect(displayed.map((item) => item.id)).toEqual(expectedIds);
	});
});

function notification(id: string, readAt: string | null): NotificationFeedItem {
	return {
		kind: 'notification',
		id,
		startedAt: id === 'unread' ? '2026-11-05T10:00:00Z' : '2026-11-04T10:00:00Z',
		notification: {
			id,
			category: 'budget',
			title: 'Budget reached',
			body: null,
			linkUrl: null,
			payload: null,
			readAt,
		},
	};
}
