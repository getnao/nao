import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	hasFeature: vi.fn(),
}));

vi.mock('../../src/agents/user-rules', () => ({
	getDatabaseContextCatalog: () => ({
		objects: [{ databaseType: 'postgres', database: 'warehouse', schema: 'finance', table: 'invoices' }],
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
import { useTemporaryFolders } from '../helpers/temporary-folders';

const createTemporaryFolder = useTemporaryFolders();
const PROJECT = { projectId: 'project-id' };
const ROW_POLICY = `
      policies:
          rows:
              - {database_type: postgres, database: warehouse, schema: finance, table: invoices, access: full}`;

describe('validateUserGroupsConfig', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.hasFeature.mockResolvedValue(false);
	});

	it('allows an unchanged configuration after its licenses expire', async () => {
		const config = parseGroups(`    - id: finance\n      list_of_emails: [ceo@example.com]${ROW_POLICY}`);

		await expect(validateUserGroupsConfig(PROJECT, '/project', config, config)).resolves.toBeUndefined();

		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});

	it('rejects a membership change after the user-groups license expires', async () => {
		const current = parseGroups('    - id: finance\n      list_of_emails: [ceo@example.com]');
		const changed = parseGroups('    - id: finance\n      list_of_emails: [new-ceo@example.com]');

		await expect(validateUserGroupsConfig(PROJECT, '/project', changed, current)).rejects.toThrow(
			'Code-managed user groups require a user groups license.',
		);
	});

	it('needs Enterprise for row policies but not for the empty restricted defaults', async () => {
		mocks.hasFeature.mockImplementation(async (feature: string) => feature === 'user-groups');

		await expect(
			validateUserGroupsConfig(PROJECT, '/project', parseGroups('    - id: finance')),
		).resolves.toBeUndefined();
		await expect(
			validateUserGroupsConfig(PROJECT, '/project', parseGroups(`    - id: finance${ROW_POLICY}`)),
		).rejects.toThrow('Enterprise license');
	});

	it('rejects row policies for a project that does not exist yet', async () => {
		mocks.hasFeature.mockResolvedValue(true);

		await expect(
			validateUserGroupsConfig({ orgId: 'org-id' }, '/project', parseGroups(`    - id: finance${ROW_POLICY}`)),
		).rejects.toThrow('references a table that is not protected');
	});

	it('reports every unknown reference at once', async () => {
		mocks.hasFeature.mockResolvedValue(true);
		const config = parseGroups(`    - id: finance
      capabilities:
          skills: {mode: restricted, allowed: [forecasting]}
          mcp: {mode: restricted, grants: [{kind: server, server: github}]}
      access:
          databases: {mode: restricted, grants: [{kind: schema, database_type: postgres, database: warehouse, schema: hr}]}
          files: {mode: restricted, grants: [{kind: folder, path: docs/finance}]}`);

		const error = await validateUserGroupsConfig(PROJECT, createTemporaryFolder('nao-groups-'), config).catch(
			(caught: Error) => caught,
		);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message.split('\n')).toEqual([
			'"finance": unknown schema postgres.warehouse.hr in access.databases. Run nao sync first.',
			'"finance": unknown folder docs/finance in access.files.',
			'"finance": unknown MCP server github.',
			'"finance": unknown skill forecasting.',
		]);
	});

	it.each([
		['a filename when front matter omits the name', 'analysis.md', '---\ndescription: Analysis\n---\n'],
		['a trimmed front-matter name', 'other.md', '---\nname: " analysis "\n---\n'],
	])('accepts a skill reference resolved from %s', async (_label, filename, skillSource) => {
		mocks.hasFeature.mockResolvedValue(true);
		const projectPath = createTemporaryFolder('nao-user-group-config-validation-');
		const skillsPath = path.join(projectPath, 'agent', 'skills');
		fs.mkdirSync(skillsPath, { recursive: true });
		fs.writeFileSync(path.join(skillsPath, filename), skillSource);

		await expect(validateUserGroupsConfig(PROJECT, projectPath, parseGroups(SKILL_GROUP))).resolves.toBeUndefined();
	});

	it('rejects a skill that runtime discovery excludes for leaving the skills folder', async () => {
		mocks.hasFeature.mockResolvedValue(true);
		const projectPath = createTemporaryFolder('nao-user-group-config-validation-');
		const skillsPath = path.join(projectPath, 'agent', 'skills');
		const outsideSkillPath = path.join(projectPath, 'analysis.md');
		fs.mkdirSync(skillsPath, { recursive: true });
		fs.writeFileSync(outsideSkillPath, '---\ndescription: Analysis\n---\n');
		fs.symlinkSync(outsideSkillPath, path.join(skillsPath, 'analysis.md'));

		await expect(validateUserGroupsConfig(PROJECT, projectPath, parseGroups(SKILL_GROUP))).rejects.toThrow(
			'"finance": unknown skill analysis.',
		);
	});
});

const SKILL_GROUP = `    - id: finance
      capabilities:
          skills: {mode: restricted, allowed: [analysis], preloaded: [analysis]}`;

function parseGroups(groups: string) {
	return parseUserGroupsConfig(`groups:\n    - id: all_users\n${groups}\n`);
}
