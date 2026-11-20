import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { getByStoryId, removeSpecificRecipients } from '../../src/queries/story-delivery.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const OWNER = { projectId: 'delivery-project', userId: 'delivery-owner' };

beforeAll(async () => {
	await db.insert(s.user).values({ id: OWNER.userId, name: 'Owner', email: 'delivery-owner@example.com' });
	await db.insert(s.project).values({ id: OWNER.projectId, name: 'Delivery', type: 'local', path: '/tmp/delivery' });
	await db.insert(s.story).values([
		{ id: 'story-to-two', ...OWNER, slug: 'to-two', title: 'To two people' },
		{ id: 'story-to-all', ...OWNER, slug: 'to-all', title: 'To everyone' },
	]);
	await db.insert(s.storyDelivery).values([
		{
			storyId: 'story-to-two',
			channels: ['email'],
			recipientMode: 'specific',
			recipientUserIds: ['removed-user', 'kept-user'],
			recipientGroupIds: ['removed-group'],
		},
		{ storyId: 'story-to-all', channels: ['email'], recipientMode: 'all', recipientUserIds: ['removed-user'] },
	]);
});

afterAll(() => {
	db.$client.close();
});

describe('removeSpecificRecipients', () => {
	const removed = { userIds: ['removed-user'], groupIds: ['removed-group'] };

	it('takes the removed people and groups off the delivery and counts who is left', async () => {
		expect(await removeSpecificRecipients('story-to-two', removed)).toBe(1);
		expect(await getByStoryId('story-to-two')).toMatchObject({
			recipientUserIds: ['kept-user'],
			recipientGroupIds: [],
		});
	});

	it.each([
		{ name: 'a delivery to everyone the story is shared with', storyId: 'story-to-all' },
		{ name: 'a story without delivery', storyId: 'story-without-delivery' },
	])('leaves $name untouched', async ({ storyId }) => {
		expect(await removeSpecificRecipients(storyId, removed)).toBeNull();
		expect((await getByStoryId('story-to-all'))?.recipientUserIds).toEqual(['removed-user']);
	});
});
