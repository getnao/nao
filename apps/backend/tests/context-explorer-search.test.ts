import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
});

import { searchFileContents } from '../src/services/context-explorer.service';

describe('context explorer content search', () => {
	let projectFolder: string;

	beforeAll(() => {
		projectFolder = mkdtempSync(join(tmpdir(), 'nao-context-explorer-search-'));
		writeFileSync(join(projectFolder, 'literal.txt'), 'literal target\nliteral target\n');
		writeFileSync(join(projectFolder, 'case.txt'), 'MixedCaseToken\n');
		writeFileSync(join(projectFolder, 'regex-literal.txt'), 'a.c\n');
		writeFileSync(join(projectFolder, 'regex-only.txt'), 'abc\n');
		writeFileSync(join(projectFolder, 'ignored.txt'), 'excluded content\n');
		writeFileSync(join(projectFolder, 'git-ignored.txt'), 'git ignored content\n');
		writeFileSync(join(projectFolder, '.gitignore'), 'git-ignored.txt\n');
		writeFileSync(join(projectFolder, '.naoignore'), 'ignored.txt\n');
		mkdirSync(join(projectFolder, '.git'));
		writeFileSync(join(projectFolder, '.git', 'config'), 'protected content\n');
		writeFileSync(join(projectFolder, '.env'), 'protected content\n');
		writeFileSync(join(projectFolder, '.env.local'), 'protected content\n');
		chmodSync(join(projectFolder, '.git'), 0o000);
		chmodSync(join(projectFolder, '.env'), 0o000);
		chmodSync(join(projectFolder, '.env.local'), 0o000);
	});

	afterAll(() => {
		chmodSync(join(projectFolder, '.git'), 0o700);
		rmSync(projectFolder, { recursive: true, force: true });
	});

	it('returns grouped literal content matches with their virtual path and count', async () => {
		const response = await searchFileContents('literal target', projectFolder);

		expect(response.results).toEqual([
			{
				path: '/literal.txt',
				count: 2,
				line: 1,
				text: 'literal target',
			},
		]);
		expect(response.truncated).toBe(false);
	});

	it('matches content case-insensitively', async () => {
		const response = await searchFileContents('mixedcasetoken', projectFolder);

		expect(response.results.map((result) => result.path)).toEqual(['/case.txt']);
	});

	it('treats regex metacharacters as literal text', async () => {
		const response = await searchFileContents('a.c', projectFolder);

		expect(response.results.map((result) => result.path)).toEqual(['/regex-literal.txt']);
	});

	it('excludes files matched by .naoignore', async () => {
		const response = await searchFileContents('excluded content', projectFolder);

		expect(response.results).toEqual([]);
	});

	it('searches files matched by .gitignore', async () => {
		const response = await searchFileContents('git ignored content', projectFolder);

		expect(response.results.map((result) => result.path)).toEqual(['/git-ignored.txt']);
	});

	it('excludes protected Git metadata and environment files', async () => {
		const response = await searchFileContents('protected content', projectFolder);

		expect(response.results).toEqual([]);
	});
});
