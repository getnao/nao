import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
	process.env.NAO_CONTEXT_SOURCE = 'local';
});

const mocks = vi.hoisted(() => ({
	listUsersWithProjectAccess: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({
	listUsersWithProjectAccess: mocks.listUsersWithProjectAccess,
}));

vi.mock('../../src/services/nao-draft.service', () => ({
	hasContextRepository: async () => true,
	getNaoDraftFileTree: async () => [],
}));

import {
	type ContextExplorerFileAccess,
	MAX_CONTEXT_FILE_SIZE,
	readFileContent,
} from '../../src/services/context-explorer.service';
import {
	applyOwnerToTableFiles,
	listContextFileHeaderProblems,
	listContextFileOwners,
	listTableFileOwners,
} from '../../src/services/context-file-header.service';
import { createContextGitFixture, fileAccess, writeFiles } from '../helpers/context-git-fixture';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const ORDERS = 'databases/type=duckdb/database=shop/schema=main/table=orders';
const CUSTOMERS = 'databases/type=duckdb/database=shop/schema=main/table=customers';

describe('context file headers', () => {
	const createTemporaryFolder = useTemporaryFolders();
	let access: ContextExplorerFileAccess;
	let liveFolder: string;

	beforeEach(async () => {
		mocks.listUsersWithProjectAccess.mockResolvedValue([
			{ id: 'u2', name: 'Zoe', email: 'zoe@example.com', role: 'user', status: 'active' },
			{ id: 'u1', name: 'Ada', email: 'Ada@Example.com', role: 'admin', status: 'active' },
		]);
		const files = {
			'nao_config.yaml': 'name: project\n',
			'owned.md': '---\nowner: ada@example.com\n---\nbody\n',
			'docs/orphan.md': '---\ntitle: Orphan\nowner: gone@example.com\n---\nbody\n',
			'docs/broken.md': '---\ntitle: [unclosed\n---\nbody\n',
			'docs/long.md': `---\ndescription: ${'x'.repeat(10_000)}\nowner: gone@example.com\n---\nbody\n`,
			'plain.md': 'no header\n',
			'notes.txt': '---\nowner: gone@example.com\n---\n',
			[`${ORDERS}/description.md`]: '---\nowner: zoe@example.com\n---\nOrders\n',
			[`${ORDERS}/columns.md`]: '---\ntitle: Columns\nowner: zoe@example.com\n---\nColumns\n',
			[`${ORDERS}/preview.md`]: 'Preview\n',
			[`${ORDERS}/how_to_use.md`]: '---\nowner: ADA@example.com\n---\nUsage\n',
			[`${ORDERS}/ai_summary.md`]: '---\ntype: generated\nowner: zoe@example.com\n---\nSummary\n',
			[`${CUSTOMERS}/columns.md`]: '---\nowner: zoe@example.com\n---\nColumns\n',
		};
		const fixture = createContextGitFixture(createTemporaryFolder('nao-context-header-'), files);
		writeFiles(fixture.live, files);
		liveFolder = fixture.live;
		access = await fileAccess(fixture.context);
	});

	it('lists the users of the project as owners, sorted by name', async () => {
		expect(await listContextFileOwners('project')).toEqual([
			{ id: 'u1', name: 'Ada', email: 'Ada@Example.com' },
			{ id: 'u2', name: 'Zoe', email: 'zoe@example.com' },
		]);
	});

	it('reports the Markdown files with a broken header or an unknown owner', async () => {
		const problems = await listContextFileHeaderProblems('project', access);

		expect(
			problems.map(({ path, problems: fileProblems }) => [path, fileProblems.map((problem) => problem.kind)]),
		).toEqual([
			['/docs/broken.md', ['invalid-header']],
			['/docs/long.md', ['unknown-owner']],
			['/docs/orphan.md', ['unknown-owner']],
		]);
	});

	it('lists the owner of the other files of the table, leaving out the ones too large to read', async () => {
		writeFiles(liveFolder, { [`${ORDERS}/too_large.md`]: 'x'.repeat(MAX_CONTEXT_FILE_SIZE + 1) });

		expect(await listTableFileOwners('project', `/${ORDERS}/description.md`, access)).toEqual([
			{ path: `/${ORDERS}/ai_summary.md`, owner: 'zoe@example.com', isEditable: false },
			{ path: `/${ORDERS}/columns.md`, owner: 'zoe@example.com', isEditable: true },
			{ path: `/${ORDERS}/how_to_use.md`, owner: 'ADA@example.com', isEditable: true },
			{ path: `/${ORDERS}/preview.md`, owner: null, isEditable: true },
		]);
	});

	it('gives the editable files of the table the owner, leaving other tables and generated files', async () => {
		const result = await applyOwnerToTableFiles('project', `/${ORDERS}/description.md`, 'ada@example.com', access);

		expect(result).toEqual({ updatedPaths: [`/${ORDERS}/columns.md`, `/${ORDERS}/preview.md`], failedPaths: [] });
		expect(await readContents(access)).toEqual({
			[`/${ORDERS}/description.md`]: '---\nowner: zoe@example.com\n---\nOrders\n',
			[`/${ORDERS}/columns.md`]: '---\ntitle: Columns\nowner: ada@example.com\n---\nColumns\n',
			[`/${ORDERS}/preview.md`]: '---\nowner: ada@example.com\n---\n\nPreview\n',
			[`/${ORDERS}/how_to_use.md`]: '---\nowner: ADA@example.com\n---\nUsage\n',
			[`/${ORDERS}/ai_summary.md`]: '---\ntype: generated\nowner: zoe@example.com\n---\nSummary\n',
			[`/${CUSTOMERS}/columns.md`]: '---\nowner: zoe@example.com\n---\nColumns\n',
		});
	});

	it('only updates the files asked for, like the ones that failed to save before', async () => {
		const result = await applyOwnerToTableFiles('project', `/${ORDERS}/description.md`, 'ada@example.com', access, [
			`/${ORDERS}/preview.md`,
		]);

		expect(result).toEqual({ updatedPaths: [`/${ORDERS}/preview.md`], failedPaths: [] });
		expect((await readContents(access))[`/${ORDERS}/columns.md`]).toContain('owner: zoe@example.com');
	});

	it('removes the owner from the files of the table', async () => {
		await applyOwnerToTableFiles('project', `/${ORDERS}/description.md`, null, access);

		const contents = await readContents(access);
		expect(contents[`/${ORDERS}/columns.md`]).toBe('---\ntitle: Columns\n---\nColumns\n');
		expect(contents[`/${ORDERS}/how_to_use.md`]).toBe('Usage\n');
	});

	it('rejects a file that does not document a table', async () => {
		await expect(listTableFileOwners('project', '/docs/orphan.md', access)).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
	});
});

async function readContents(access: ContextExplorerFileAccess): Promise<Record<string, string>> {
	const paths = [
		`/${ORDERS}/description.md`,
		`/${ORDERS}/columns.md`,
		`/${ORDERS}/preview.md`,
		`/${ORDERS}/how_to_use.md`,
		`/${ORDERS}/ai_summary.md`,
		`/${CUSTOMERS}/columns.md`,
	];
	const files = await Promise.all(paths.map((path) => readFileContent(path, access)));
	return Object.fromEntries(paths.map((path, index) => [path, files[index].content]));
}
