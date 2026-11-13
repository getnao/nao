import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	hasFeature: vi.fn(),
}));

vi.mock('../../src/agents/user-rules', () => ({
	getDatabaseContextCatalog: () => ({
		objects: [
			{
				databaseType: 'postgres',
				database: 'warehouse',
				schema: 'finance',
				table: 'invoices',
			},
		],
	}),
}));
vi.mock('../../src/queries/user-group.queries', () => ({
	getProjectRowSecurity: () => ({
		tables: [
			{
				databaseType: 'postgres',
				database: 'warehouse',
				schema: 'finance',
				table: 'invoices',
				constraintColumns: ['region'],
			},
		],
	}),
}));
vi.mock('../../src/services/file-tree-catalog.service', () => ({
	getDocsContextCatalog: () => ({ entries: [] }),
	getFilesContextCatalog: () => ({ entries: [] }),
}));
vi.mock('../../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: {
		rowLevelSecurity: 'row-level-security',
		userBudget: 'user-budget',
		userGroups: 'user-groups',
	},
}));
vi.mock('../../src/services/warehouse-sql.service', () => ({
	validateWarehouseRowPredicate: vi.fn(),
}));

import { parseUserGroupsConfig } from '../../src/services/user-group-config.service';
import { validateUserGroupsConfig } from '../../src/services/user-group-config-validation.service';

describe('validateUserGroupsConfig', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasFeature.mockResolvedValue(false);
	});

	it('allows an unchanged configuration after its licenses expire', async () => {
		const config = parseUserGroupsConfig(readGuideExample());

		await expect(validateUserGroupsConfig('project-id', '/project', config, config)).resolves.toBeUndefined();

		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('rejects a membership change after the user-groups license expires', async () => {
		const current = parseUserGroupsConfig(readGuideExample());
		const changed = parseUserGroupsConfig(readGuideExample().replace('ceo@example.com', 'new-ceo@example.com'));

		await expect(validateUserGroupsConfig('project-id', '/project', changed, current)).rejects.toThrow(
			'Code-managed user groups require a user groups license.',
		);
	});
});

function readGuideExample(): string {
	const guide = fs.readFileSync(
		path.resolve(import.meta.dirname, '../../../../USER_GROUPS_AS_CODE_ADMIN_GUIDE.md'),
		'utf8',
	);
	const example = guide.match(/<!-- validated-example:start -->\s*```yaml\n([\s\S]*?)\n```/)?.[1];
	if (!example) {
		throw new Error('The administrator guide example is missing.');
	}
	return example;
}
