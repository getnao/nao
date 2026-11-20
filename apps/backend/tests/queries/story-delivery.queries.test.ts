import '../../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { getByStoryId, keepSpecificRecipients } from '../../src/queries/story-delivery.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const OWNER = { projectId: 'delivery-project', userId: 'delivery-owner' };
const STORY_ID = 'delivered-story';
const JOB_ID = 'delivery-job';

beforeAll(async () => {
	await db.insert(s.user).values({ id: OWNER.userId, name: 'Owner', email: 'delivery-owner@example.com' });
	await db.insert(s.project).values({ id: OWNER.projectId, name: 'Delivery', type: 'local', path: '/tmp/delivery' });
	await db.insert(s.story).values({ id: STORY_ID, ...OWNER, slug: 'delivered', title: 'Delivered' });
});

beforeEach(async () => {
	await db.delete(s.storyDelivery);
	await db.delete(s.scheduledJob);
	await db.insert(s.scheduledJob).values({ id: JOB_ID, name: 'story.deliver', runAt: new Date() });
});

afterAll(() => {
	db.$client.close();
});

describe('keepSpecificRecipients', () => {
	const keepsOnly = (keptId: string) => (recipient: { id: string }) => recipient.id === keptId;

	it('drops the people and groups it is told not to keep', async () => {
		await deliverTo({ recipientMode: 'specific' });

		await keepSpecificRecipients(STORY_ID, keepsOnly('kept-user'));

		expect(await getByStoryId(STORY_ID)).toMatchObject({
			enabled: true,
			recipientUserIds: ['kept-user'],
			recipientGroupIds: [],
			scheduledJobId: JOB_ID,
		});
	});

	it('turns off a delivery left with nobody, with its scheduled job', async () => {
		await deliverTo({ recipientMode: 'specific' });

		await keepSpecificRecipients(STORY_ID, () => false);

		expect(await getByStoryId(STORY_ID)).toMatchObject({ enabled: false, scheduledJobId: null });
		expect(await db.select().from(s.scheduledJob)).toEqual([]);
	});

	it('leaves a delivery to everyone the story is shared with untouched', async () => {
		await deliverTo({ recipientMode: 'all' });

		await keepSpecificRecipients(STORY_ID, () => false);

		expect(await getByStoryId(STORY_ID)).toMatchObject({
			enabled: true,
			recipientUserIds: ['removed-user', 'kept-user'],
		});
	});
});

async function deliverTo({ recipientMode }: { recipientMode: 'specific' | 'all' }) {
	await db.insert(s.storyDelivery).values({
		storyId: STORY_ID,
		enabled: true,
		channels: ['email'],
		recipientMode,
		recipientUserIds: ['removed-user', 'kept-user'],
		recipientGroupIds: ['removed-group'],
		scheduledJobId: JOB_ID,
	});
}
