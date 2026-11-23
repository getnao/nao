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
import { formatUserGroupsConfig } from '../../src/services/user-group-config-format.service';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const createTemporaryFolder = useTemporaryFolders();
const EMPLOYEES_TABLE = { databaseType: 'postgres', database: 'warehouse', schema: 'hr', table: 'employees' };

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
				name: 'Les Nobles',
				featureGrants: storedFeatureGrants(false),
			},
			{
				id: 'export-finance',
				projectId: 'export-project',
				name: 'Finance',
				configKey: 'finance',
				featureGrants: storedFeatureGrants(true),
				columnPolicies: { version: 1, policies: [{ ...EMPLOYEES_TABLE, grantedColumns: ['iban', 'salary'] }] },
			},
		]);
		await db
			.insert(s.userGroupConfigMember)
			.values({ groupId: 'export-finance', normalizedEmail: 'pending@example.com', active: true });

		const source = await exportUserGroupsConfig('export-project', projectPath);
		const exported = parseUserGroupsConfig(source);

		expect(formatUserGroupsConfig(source)).toBe(source);
		expect(source).toContain('groups:\n    - id: all_users');
		expect(source).toContain('\n    - id: les_nobles');
		expect(source).not.toContain('show_all_settings');
		expect(exported.allUsers.advancedContextExplorer).toBe(false);
		expect(exported.groups).toEqual([
			expect.objectContaining({
				key: 'finance',
				name: 'Finance',
				members: ['pending@example.com'],
				advancedContextExplorer: true,
				columnPolicies: { version: 1, policies: [{ ...EMPLOYEES_TABLE, grantedColumns: ['iban', 'salary'] }] },
			}),
			expect.objectContaining({
				key: 'les_nobles',
				name: 'Les Nobles',
				members: [],
				advancedContextExplorer: false,
			}),
		]);
	});

	it('normalizes a persisted legacy config key before export', async () => {
		const projectPath = createTemporaryFolder('nao-groups-invalid-export-');
		await db
			.insert(s.project)
			.values({ id: 'invalid-export-project', name: 'Invalid export project', type: 'local', path: projectPath });
		await db.insert(s.userGroup).values([
			{
				id: 'invalid-export-all-users',
				projectId: 'invalid-export-project',
				name: 'All Users',
				isDefault: true,
				featureGrants: storedFeatureGrants(false),
			},
			{
				id: 'invalid-export-group',
				projectId: 'invalid-export-project',
				name: 'Les Nobles',
				configKey: 'les-nobles',
				featureGrants: storedFeatureGrants(false),
			},
		]);

		const source = await exportUserGroupsConfig('invalid-export-project', projectPath);

		expect(parseUserGroupsConfig(source).groups).toEqual([
			expect.objectContaining({ key: 'les_nobles', name: 'Les Nobles' }),
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
