import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
});

import { getTableColumnsContent, getUserRules, resetDatabaseContextCachesForTesting } from '../src/agents/user-rules';
import { searchFileContents } from '../src/services/context-explorer.service';

const OUTSIDE_CONTENT = 'content of another tenant';
const unrestrictedAccess = { enforced: false } as const;
const TABLE_FOLDER = join('databases', 'type=duckdb', 'database=db', 'schema=main', 'table=orders');

describe('project reads through symlinks', () => {
	let root: string;
	let projectFolder: string;
	let outsideFolder: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'nao-project-symlinks-'));
		projectFolder = join(root, 'project');
		outsideFolder = join(root, 'outside');
		mkdirSync(projectFolder);
		mkdirSync(outsideFolder);
		writeFileSync(join(outsideFolder, 'secret.md'), `${OUTSIDE_CONTENT}\n`);
		resetDatabaseContextCachesForTesting();
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('ignores a RULES.md that links outside the project', () => {
		symlinkSync(join(outsideFolder, 'secret.md'), join(projectFolder, 'RULES.md'));

		expect(getUserRules(projectFolder)).toBeUndefined();
	});

	it('reads a RULES.md that links to a file inside the project', () => {
		writeFileSync(join(projectFolder, 'shared-rules.md'), 'Answer in French.\n');
		symlinkSync(join(projectFolder, 'shared-rules.md'), join(projectFolder, 'RULES.md'));

		expect(getUserRules(projectFolder)).toContain('Answer in French.');
	});

	it('ignores a columns.md that links outside the project', () => {
		mkdirSync(join(projectFolder, TABLE_FOLDER), { recursive: true });
		symlinkSync(join(outsideFolder, 'secret.md'), join(projectFolder, TABLE_FOLDER, 'columns.md'));

		expect(getTableColumnsContent(projectFolder, 'db.main.orders', unrestrictedAccess)).toBeUndefined();
	});

	it('reads a regular columns.md', () => {
		mkdirSync(join(projectFolder, TABLE_FOLDER), { recursive: true });
		writeFileSync(join(projectFolder, TABLE_FOLDER, 'columns.md'), '- id (INTEGER)\n');

		expect(getTableColumnsContent(projectFolder, 'db.main.orders', unrestrictedAccess)).toBe('- id (INTEGER)\n');
	});

	it('does not search a tests folder that links outside the project', async () => {
		symlinkSync(outsideFolder, join(projectFolder, 'tests'));

		const response = await searchFileContents(OUTSIDE_CONTENT, projectFolder);

		expect(response.results).toEqual([]);
	});

	it('searches a regular tests folder', async () => {
		mkdirSync(join(projectFolder, 'tests'));
		writeFileSync(join(projectFolder, 'tests', 'revenue.yml'), 'reference question\n');

		const response = await searchFileContents('reference question', projectFolder);

		expect(response.results.map((result) => result.path)).toEqual(['/tests/revenue.yml']);
	});
});
