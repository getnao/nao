import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { __reloadEnvForTesting } from '../../src/env';
import { listObjectLogs } from '../../src/queries/log.queries';
import { logStoryFailure } from '../../src/services/story-log';
import { listStoryMount, readStoryMountFile, writeStoryMountFile } from '../../src/services/story-mount';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

vi.mock('../../src/services/editable-story', async () => {
	const { db: database } = await import('../../src/db/db');
	const { default: schema } = await import('../../src/db/abstractSchema');
	const { eq } = await import('drizzle-orm');
	return {
		findEditableStory: async (_scope: unknown, storyId: string) => {
			const [story] = await database.select().from(schema.story).where(eq(schema.story.id, storyId));
			return { story };
		},
	};
});

const STORY_ID = 'mount-logs-story';
const SCOPE = { projectId: 'mount-logs-project', userId: 'mount-logs-owner', chatId: 'mount-logs-chat' };

describe('the @logs file of a custom story', () => {
	beforeAll(async () => {
		vi.stubEnv('BETA_CUSTOM_STORIES_ENABLED', 'true');
		__reloadEnvForTesting();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await db.insert(s.user).values({ id: SCOPE.userId, name: 'Owner', email: 'owner@example.com' });
		await db.insert(s.project).values({ id: SCOPE.projectId, name: 'Logs', type: 'local', path: '/tmp/logs' });
		await db.insert(s.story).values({
			id: STORY_ID,
			projectId: SCOPE.projectId,
			userId: SCOPE.userId,
			slug: 'churn',
			title: 'Churn',
			format: 'custom',
		});
	});

	afterAll(() => {
		vi.unstubAllEnvs();
		db.$client.close();
	});

	it('shows in the story folder once something failed, and reads the logged failures', async () => {
		expect(await listStoryMount(SCOPE, `/stories/${STORY_ID}`)).toEqual([]);

		await logStoryFailure({ storyId: STORY_ID }, { kind: 'model', message: 'Model gpt-x is not available.' });
		await vi.waitFor(async () => expect(await listObjectLogs({ type: 'story', id: STORY_ID }, 10)).toHaveLength(1));

		expect(await listStoryMount(SCOPE, `/stories/${STORY_ID}`)).toEqual([
			expect.objectContaining({ path: `/stories/${STORY_ID}/@logs`, name: '@logs', type: 'file' }),
		]);
		expect(await readStoryMountFile(SCOPE, `/stories/${STORY_ID}/@logs`)).toContain('[model] draft · seen once');
	});

	it('cannot be written', async () => {
		await expect(writeStoryMountFile(SCOPE, `/stories/${STORY_ID}/@logs`, 'cleared')).rejects.toThrow(
			/is read-only/,
		);
	});
});
