import { DEFAULT_GROUP_SHARE_TARGETS, serializeUserGroupConfig } from '@nao/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { parseUserGroupsConfig } from '../../src/services/user-group-config.service';
import { exportUserGroupsConfig } from '../../src/services/user-group-config-export.service';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const createTemporaryFolder = useTemporaryFolders();

describe('exportUserGroupsConfig', () => {
	it('exports a minimal file that parses back to the stored groups', async () => {
		const projectPath = createTemporaryFolder('nao-groups-export-');
		await db
			.insert(s.project)
			.values({ id: 'export-project', name: 'Export project', type: 'local', path: projectPath });
		await db.insert(s.userGroup).values([
			{
				id: 'export-all-users',
				projectId: 'export-project',
				name: 'All Users',
				isDefault: true,
				featureGrants: storedFeatureGrants(false),
			},
			{
				id: 'export-sales',
				projectId: 'export-project',
				name: 'Sales Team',
				featureGrants: storedFeatureGrants(false),
			},
			{
				id: 'export-finance',
				projectId: 'export-project',
				name: 'Finance',
				configKey: 'finance',
				featureGrants: storedFeatureGrants(true),
			},
		]);
		await db
			.insert(s.userGroupConfigMember)
			.values({ groupId: 'export-finance', normalizedEmail: 'pending@example.com', active: true });

		const source = await exportUserGroupsConfig('export-project', projectPath);
		const exported = parseUserGroupsConfig(source);

		expect(source).not.toContain('show_all_settings');
		expect(exported.allUsers.advancedContextExplorer).toBe(false);
		expect(exported.groups).toEqual([
			expect.objectContaining({
				key: 'finance',
				name: 'Finance',
				members: ['pending@example.com'],
				advancedContextExplorer: true,
			}),
			expect.objectContaining({
				key: 'sales_team',
				name: 'Sales Team',
				members: [],
				advancedContextExplorer: false,
			}),
		]);
	});
});

function storedFeatureGrants(advancedContextExplorer: boolean) {
	return serializeUserGroupConfig(
		[],
		{ defaultDensity: 'detailed', canChange: true },
		'inherit',
		false,
		[],
		DEFAULT_GROUP_SHARE_TARGETS,
		advancedContextExplorer,
	);
}
