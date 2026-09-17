import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectContextCandidates, type ContextCandidate } from '../src/services/context-retrieval/candidates';
import { shortlistCandidates } from '../src/services/context-retrieval/rank';

vi.mock('../src/services/typesafe', () => ({
	askJev: vi.fn(),
	isTypesafeConfigured: () => true,
}));

describe('collectContextCandidates', () => {
	let projectFolder: string;

	beforeEach(() => {
		projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-retrieval-'));
	});

	afterEach(() => {
		fs.rmSync(projectFolder, { force: true, recursive: true });
	});

	it('collapses a table folder into one candidate described by its annotations and columns', async () => {
		const tableFolder = path.join(
			projectFolder,
			'databases',
			'type=duckdb',
			'database=shop',
			'schema=main',
			'table=orders',
		);
		writeFile(path.join(tableFolder, 'annotations.md'), 'One row per order.');
		writeFile(path.join(tableFolder, 'columns.md'), '---\ntype: generated\n---\n\n# orders\n\n- id (int)\n');
		writeFile(path.join(tableFolder, 'preview.md'), '| id |\n| 1 |');

		const candidates = await collectContextCandidates('/databases', projectFolder);

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			id: 'F0001',
			path: '/databases/type=duckdb/database=shop/schema=main/table=orders',
			type: 'directory',
			excerpt: 'One row per order. # orders - id (int)',
		});
	});

	it('lists text files with a frontmatter-free excerpt and skips hidden, ignored and binary entries', async () => {
		writeFile(
			path.join(projectFolder, 'docs', 'churn.md'),
			'---\ntitle: Churn\n---\n# Churn\n\nA customer churns when…',
		);
		writeFile(path.join(projectFolder, 'semantics', 'revenue.yaml'), 'metric: revenue');
		writeFile(path.join(projectFolder, 'data.duckdb'), 'binary');
		writeFile(path.join(projectFolder, '.venv', 'lib', 'module.py'), 'print(1)');
		writeFile(path.join(projectFolder, 'templates', 'columns.md'), 'template');
		writeFile(path.join(projectFolder, '.naoignore'), 'templates/\n');

		const candidates = await collectContextCandidates('/', projectFolder);

		expect(candidates.map((candidate) => candidate.path)).toEqual(['/docs/churn.md', '/semantics/revenue.yaml']);
		expect(candidates[0].excerpt).toBe('# Churn A customer churns when…');
		expect(candidates.map((candidate) => candidate.id)).toEqual(['F0001', 'F0002']);
	});

	it('rejects a path that is not a folder', async () => {
		writeFile(path.join(projectFolder, 'RULES.md'), 'rules');

		await expect(collectContextCandidates('/RULES.md', projectFolder)).rejects.toThrow('is not a folder');
	});

	function writeFile(filePath: string, content: string) {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	}
});

describe('shortlistCandidates', () => {
	const candidates = ['F0001', 'F0002', 'F0003', 'F0004'].map(candidate);

	it('scales each batch by its coverage so an irrelevant batch cannot outrank a relevant one', () => {
		const shortlist = shortlistCandidates(
			candidates,
			[
				{ probabilities: { F0001: 0.9, F0002: 0.1 }, covered: 0.05 },
				{ probabilities: { F0003: 0.6, F0004: 0.4 }, covered: 0.95 },
			],
			10,
		);

		expect(shortlist.map((entry) => entry.id)).toEqual(['F0003', 'F0004', 'F0001', 'F0002']);
	});

	it('drops candidates with no probability and caps the shortlist', () => {
		const shortlist = shortlistCandidates(
			candidates,
			[{ probabilities: { F0001: 0, F0002: 0.7, F0003: 0.2, F0004: 0.1 }, covered: 1 }],
			2,
		);

		expect(shortlist.map((entry) => entry.id)).toEqual(['F0002', 'F0003']);
	});

	function candidate(id: string): ContextCandidate {
		return { id, path: `/docs/${id}.md`, type: 'file', excerpt: '', realPath: `/tmp/${id}.md` };
	}
});
