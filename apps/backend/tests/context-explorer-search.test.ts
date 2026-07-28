import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
		writeFileSync(join(projectFolder, '.naoignore'), 'ignored.txt\n');
	});

	afterAll(() => {
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
});
