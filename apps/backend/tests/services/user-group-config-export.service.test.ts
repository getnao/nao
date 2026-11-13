import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { parseUserGroupsConfig } from '../../src/services/user-group-config.service';
import { exportUserGroupsConfig } from '../../src/services/user-group-config-export.service';

describe('exportUserGroupsConfig', () => {
	it('preserves pending desired emails while groups are code-managed', async () => {
		await db.insert(s.project).values({
			id: 'export-project',
			name: 'Export project',
			type: 'local',
			path: '/tmp/export-project',
			userGroupManagementMode: 'code',
		});
		await db.insert(s.userGroup).values([
			{ id: 'export-all-users', projectId: 'export-project', name: 'All Users', isDefault: true },
			{
				id: 'export-finance',
				projectId: 'export-project',
				name: 'Finance',
				configKey: 'finance',
			},
		]);
		await db.insert(s.userGroupConfigMember).values({
			groupId: 'export-finance',
			normalizedEmail: 'pending@example.com',
			active: true,
		});
		await db.insert(s.projectMemberBudgetSettings).values({
			projectId: 'export-project',
			period: 'month',
			defaultLimitUsd: 50,
		});

		const exported = parseUserGroupsConfig(await exportUserGroupsConfig('export-project'));

		expect(exported.allUsers.budgetLimitUsd).toBe(50);
		expect(exported.groups).toEqual([
			expect.objectContaining({ key: 'finance', members: ['pending@example.com'] }),
		]);
	});
});
