import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
	process.env.NAO_CONTEXT_SOURCE = 'local';
});

vi.mock('../src/db/db', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
	const sqliteSchema = await import('../src/db/sqlite-schema');

	const sqlite = new Database(':memory:');
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	for (const statement of statements) {
		sqlite.exec(statement);
	}
	sqlite.pragma('foreign_keys = ON');

	return { db: drizzle(sqlite, { schema: sqliteSchema }) };
});

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	type ContextExplorerFileAccess,
	createDraftFile,
	readFileContent,
	writeFileContent,
} from '../src/services/context-explorer.service';
import { createDraftContextSnapshot, removeContextSnapshot } from '../src/services/draft-context.service';
import {
	discardNaoDraftFile,
	getNaoDraftFileDiff,
	getNaoDraftFileTree,
	listNaoDraftChanges,
	readNaoDraft,
	searchNaoDraftContents,
} from '../src/services/nao-draft.service';

const OWNER = { projectId: 'draft-project', userId: 'draft-user' };
const OTHER_OWNER = { projectId: 'draft-project', userId: 'other-user' };

let root: string;
let live: string;
let access: ContextExplorerFileAccess;

beforeAll(async () => {
	await db.insert(s.user).values([
		{ id: OWNER.userId, name: 'Draft User', email: 'draft@example.com' },
		{ id: OTHER_OWNER.userId, name: 'Other User', email: 'other@example.com' },
	]);
	await db.insert(s.project).values({ id: OWNER.projectId, name: 'Draft Project', type: 'local', path: '/tmp' });
});

beforeEach(async () => {
	await db.delete(s.contextDraftFile);
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nao-draft-')));
	live = path.join(root, 'context');
	writeFiles(live, {
		'nao_config.yaml': 'project_name: live\n',
		'RULES.md': '# Rules\n',
		'docs/revenue.md': 'Revenue is net of refunds.\n',
		'generated.md': '---\ntype: generated\n---\ngenerated\n',
		'repos/source.md': 'synced\n',
	});
	access = naoDraftAccess(OWNER);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
	db.$client.close();
});

describe('File Explorer without a context repository', () => {
	it('saves edits to the user draft and leaves the live context untouched', async () => {
		const original = await readFileContent('/RULES.md', access);
		const saved = await writeFileContent('/RULES.md', '# Rules\nUse net revenue.\n', original.hash, access);
		const reread = await readFileContent('/RULES.md', access);

		expect(original).toMatchObject({ content: '# Rules\n', isEditable: true, reason: null });
		expect(reread).toMatchObject({ content: '# Rules\nUse net revenue.\n', hash: saved.hash });
		expect(read(live, 'RULES.md')).toBe('# Rules\n');
		expect((await readFileContent('/RULES.md', naoDraftAccess(OTHER_OWNER))).content).toBe('# Rules\n');
		await expect(writeFileContent('/RULES.md', 'stale\n', original.hash, access)).rejects.toMatchObject({
			code: 'CONFLICT',
		});
	});

	it('keeps only one of two saves made from the same content', async () => {
		const original = await readFileContent('/RULES.md', access);
		const firstContents = ['# First tab\n', '# Second tab\n'];
		const firstSaves = await Promise.allSettled(
			firstContents.map((content) => writeFileContent('/RULES.md', content, original.hash, access)),
		);
		const draft = await readFileContent('/RULES.md', access);
		const nextContents = ['# Third tab\n', '# Rules\n'];
		const nextSaves = await Promise.allSettled(
			nextContents.map((content) => writeFileContent('/RULES.md', content, draft.hash, access)),
		);

		expect(draft.content).toBe(firstContents[findOnlySavedIndex(firstSaves)]);
		expect((await readFileContent('/RULES.md', access)).content).toBe(nextContents[findOnlySavedIndex(nextSaves)]);
	});

	it('drops the draft of a file saved back to its production content', async () => {
		const original = await readFileContent('/RULES.md', access);
		const saved = await writeFileContent('/RULES.md', '# Draft\n', original.hash, access);
		await writeFileContent('/RULES.md', '# Rules\n', saved.hash, access);

		expect(await listNaoDraftChanges(OWNER)).toEqual([]);
	});

	it('creates new files in the draft only', async () => {
		await createDraftFile('/tests/revenue.yml', 'prompt: What is the revenue?\n', access);
		const tree = await getNaoDraftFileTree(OWNER, live);

		expect((await readFileContent('/tests/revenue.yml', access)).content).toBe('prompt: What is the revenue?\n');
		expect(tree.find((entry) => entry.name === 'tests')).toEqual({
			name: 'tests',
			path: '/tests',
			type: 'directory',
			children: [{ name: 'revenue.yml', path: '/tests/revenue.yml', type: 'file' }],
		});
		expect(tree.findIndex((entry) => entry.name === 'tests')).toBeLessThan(
			tree.findIndex((entry) => entry.type === 'file'),
		);
		expect(fs.existsSync(path.join(live, 'tests/revenue.yml'))).toBe(false);
		await expect(createDraftFile('/tests/revenue.yml', 'again\n', access)).rejects.toMatchObject({
			code: 'CONFLICT',
		});
		await expect(createDraftFile('/RULES.md', 'shadow\n', access)).rejects.toMatchObject({ code: 'CONFLICT' });
		await expect(createDraftFile('/.env.test', 'secret\n', access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});

	it('keeps production-only, generated and synced files read-only', async () => {
		const config = await readFileContent('/nao_config.yaml', access);
		const generated = await readFileContent('/generated.md', access);
		const synced = await readFileContent('/repos/source.md', access);

		expect(config).toMatchObject({ isEditable: false, reason: 'production-only' });
		expect(generated).toMatchObject({ isEditable: false, reason: 'generated' });
		expect(synced).toMatchObject({ isEditable: false, reason: 'synced-source' });
		await expect(writeFileContent('/nao_config.yaml', 'hijacked\n', config.hash, access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(createDraftFile('/agent/mcps/mcp.json', '{}\n', access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
	});

	it('lists, diffs and discards the draft changes', async () => {
		await editFile('/RULES.md', '# Draft rules\n');
		await createDraftFile('/docs/margin.md', 'Margin is revenue minus cost.\n', access);

		const changes = await listNaoDraftChanges(OWNER);
		const diff = await getNaoDraftFileDiff(OWNER, live, '/RULES.md');
		const discarded = await discardNaoDraftFile(OWNER, live, '/RULES.md');

		expect(changes).toEqual([
			{ path: '/docs/margin.md', kind: 'untracked', additions: null, deletions: null },
			{ path: '/RULES.md', kind: 'modified', additions: null, deletions: null },
		]);
		expect(diff).toMatchObject({ oldContent: '# Rules\n', newContent: '# Draft rules\n' });
		expect(discarded.hash).toBe((await readFileContent('/RULES.md', access)).hash);
		expect((await listNaoDraftChanges(OWNER)).map((change) => change.path)).toEqual(['/docs/margin.md']);
	});

	it('discards a draft whose production file can no longer be edited', async () => {
		const original = await readFileContent('/RULES.md', access);
		await writeFileContent('/RULES.md', '# Draft rules\n', original.hash, access);
		fs.writeFileSync(path.join(live, 'RULES.md'), Buffer.from([0, 159, 146, 150]));

		await discardNaoDraftFile(OWNER, live, '/RULES.md');

		expect(await listNaoDraftChanges(OWNER)).toEqual([]);
	});

	it('searches the content of the draft in place of the live content', async () => {
		await editFile('/docs/revenue.md', 'Revenue is gross.\nGross revenue includes taxes, gross of refunds.\n');
		await createDraftFile('/docs/margin.md', 'Margin is gross revenue minus costs.\n', access);

		const response = await searchNaoDraftContents(OWNER, live, 'GROSS');
		const otherUserResponse = await searchNaoDraftContents(OTHER_OWNER, live, 'net of refunds');

		expect(response.results).toEqual([
			{ path: '/docs/margin.md', count: 1, line: 1, text: 'Margin is gross revenue minus costs.' },
			{ path: '/docs/revenue.md', count: 3, line: 1, text: 'Revenue is gross.' },
		]);
		expect((await searchNaoDraftContents(OWNER, live, 'net of refunds')).results).toEqual([]);
		expect(otherUserResponse.results.map((result) => result.path)).toEqual(['/docs/revenue.md']);
	});

	it('caps the draft search like the live search, cutting long lines and flagging dropped files', async () => {
		await db.insert(s.contextDraftFile).values(
			Array.from({ length: 201 }, (_, index) => ({
				...OWNER,
				path: `docs/draft-${String(index).padStart(3, '0')}.md`,
				content: `gross ${'x'.repeat(2_000)}\n`,
				baseHash: null,
			})),
		);

		const response = await searchNaoDraftContents(OWNER, live, 'gross');

		expect(response.results).toHaveLength(200);
		expect(response.truncated).toBe(true);
		expect(response.results[0].text).toHaveLength(500);
	});
});

describe('readNaoDraft', () => {
	it('builds a snapshot of production with the draft applied and flags production updates', async () => {
		await editFile('/RULES.md', '# Draft rules\n');
		await editFile('/docs/revenue.md', 'Revenue excludes taxes.\n');
		await createDraftFile('/tests/revenue.yml', 'prompt: What is the revenue?\n', access);
		writeFiles(live, { 'docs/revenue.md': 'Production changed this.\n' });

		const draft = await readNaoDraft(OWNER, live);
		const snapshot = createDraftContextSnapshot({ projectId: OWNER.projectId, projectFolder: live, draft });

		expect(draft.context).toMatchObject({ storage: 'nao', branch: null, productionCommit: null });
		expect(draft.context.changes).toEqual([
			{ path: 'docs/revenue.md', kind: 'modified' },
			{ path: 'RULES.md', kind: 'modified' },
			{ path: 'tests/revenue.yml', kind: 'added' },
		]);
		expect(draft.context.outdatedPaths).toEqual(['docs/revenue.md']);
		expect(read(snapshot.folder, 'RULES.md')).toBe('# Draft rules\n');
		expect(read(snapshot.folder, 'tests/revenue.yml')).toBe('prompt: What is the revenue?\n');
		expect(read(snapshot.folder, 'nao_config.yaml')).toBe('project_name: live\n');
		expect(read(live, 'RULES.md')).toBe('# Rules\n');
		removeContextSnapshot(snapshot.folder);
	});
});

async function editFile(filePath: string, content: string): Promise<void> {
	const file = await readFileContent(filePath, access);
	await writeFileContent(filePath, content, file.hash, access);
}

function findOnlySavedIndex(saves: PromiseSettledResult<unknown>[]): number {
	expect(saves.filter((save) => save.status === 'fulfilled')).toHaveLength(1);
	expect(saves.find((save) => save.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
	return saves.findIndex((save) => save.status === 'fulfilled');
}

function naoDraftAccess(owner: typeof OWNER): ContextExplorerFileAccess {
	return {
		projectFolder: live,
		git: { status: 'unavailable', reason: 'no-repo', message: 'No context repository is connected.', repo: null },
		draftOwner: owner,
	};
}

function writeFiles(folder: string, files: Record<string, string>): void {
	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(folder, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	}
}

function read(folder: string, relativePath: string): string {
	return fs.readFileSync(path.join(folder, relativePath), 'utf-8');
}
