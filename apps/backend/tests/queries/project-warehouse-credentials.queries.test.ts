import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { getProjectWarehouseCredentialsByIdentity } from '../../src/queries/project-warehouse-credentials.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

describe('getProjectWarehouseCredentialsByIdentity', () => {
	beforeAll(async () => {
		await db.insert(s.organization).values([
			{ id: 'org-a', name: 'Organization A', slug: 'org-a' },
			{ id: 'org-b', name: 'Organization B', slug: 'org-b' },
		]);
		await db.insert(s.project).values([
			{
				id: 'project-a',
				orgId: 'org-a',
				name: 'Project A',
				type: 'local',
				path: '/tmp/project-a',
			},
			{
				id: 'project-b',
				orgId: 'org-b',
				name: 'Project B',
				type: 'local',
				path: '/tmp/project-b',
			},
		]);
		await db.insert(s.projectWarehouseCredentials).values([
			{ projectId: 'project-a', provider: 'postgres', encryptedCredentials: 'warehouse-a' },
			{ projectId: 'project-b', provider: 'postgres', encryptedCredentials: 'warehouse-b' },
		]);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('returns credentials only when both project and organization identity match', async () => {
		await expect(getProjectWarehouseCredentialsByIdentity('project-a', 'org-a')).resolves.toMatchObject({
			projectId: 'project-a',
			encryptedCredentials: 'warehouse-a',
		});

		await expect(getProjectWarehouseCredentialsByIdentity('project-a', 'org-b')).resolves.toBeNull();
		await expect(getProjectWarehouseCredentialsByIdentity('project-b', 'org-a')).resolves.toBeNull();
	});
});
