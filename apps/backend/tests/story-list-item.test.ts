import { describe, expect, it } from 'vitest';

import { STORY_LIST_ITEM_SCHEMA, toStoryListItem } from '../src/mcp/tools/story-list-item';
import type { UserStoryRow } from '../src/queries/story.queries';

function buildStoryRow(overrides: Partial<UserStoryRow> = {}): UserStoryRow {
	return {
		id: 'story-1',
		chatId: null,
		projectId: 'project-1',
		userId: 'user-1',
		slug: 'revenue-dashboard',
		title: 'Revenue Dashboard',
		isLive: false,
		isLiveTextDynamic: true,
		cacheSchedule: null,
		cacheScheduleDescription: null,
		archivedAt: null,
		createdAt: new Date('2024-01-01T00:00:00.000Z'),
		updatedAt: new Date('2024-01-02T03:04:05.000Z'),
		code: '# Revenue\n',
		...overrides,
	};
}

describe('list_stories output mapping', () => {
	it('serializes createdAt/updatedAt as ISO strings that satisfy the output schema', () => {
		const item = toStoryListItem(buildStoryRow(), {
			url: 'http://localhost:5005/stories/standalone/story-1',
			chatUrl: null,
		});

		expect(item.createdAt).toBe('2024-01-01T00:00:00.000Z');
		expect(item.updatedAt).toBe('2024-01-02T03:04:05.000Z');
		expect(() => STORY_LIST_ITEM_SCHEMA.parse(item)).not.toThrow();
	});

	it('marks archived stories and preserves chatUrl', () => {
		const item = toStoryListItem(buildStoryRow({ archivedAt: new Date('2024-02-01T00:00:00.000Z') }), {
			url: 'http://localhost:5005/stories/standalone/story-1',
			chatUrl: 'http://localhost:5005/chats/chat-1',
		});

		expect(item.archived).toBe(true);
		expect(item.chatUrl).toBe('http://localhost:5005/chats/chat-1');
		expect(() => STORY_LIST_ITEM_SCHEMA.parse(item)).not.toThrow();
	});
});
