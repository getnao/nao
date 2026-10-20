import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { upsertSystemExampleProject } from '../../src/queries/project.queries';

describe('system example project', () => {
	afterAll(() => db.$client.close());

	it('upserts the project with one fully granted default group', async () => {
		await upsertSystemExampleProject('/tmp/example-a');
		const stored = await upsertSystemExampleProject('/tmp/example-b');
		const groups = await db.select().from(s.userGroup).where(eq(s.userGroup.projectId, 'system-example-project'));

		expect(stored).toMatchObject({ id: 'system-example-project', path: '/tmp/example-b' });
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			name: 'All Users',
			isDefault: true,
			featureGrants: {
				version: 2,
				features: ['storyCreation', 'customStoryCreation', 'automationCreation'],
			},
			contextGrants: {
				version: 6,
				databaseAccess: { mode: 'all', strict: false },
				docsAccess: { mode: 'all' },
				mcpAccess: { mode: 'all' },
			},
		});
	});
});
