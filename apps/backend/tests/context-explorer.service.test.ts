import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readFileContent } from '../src/services/context-explorer.service';

describe('readFileContent', () => {
	let projectFolder: string;
	let testFolder: string;

	beforeEach(() => {
		testFolder = mkdtempSync(join(tmpdir(), 'nao-context-explorer-'));
		projectFolder = join(testFolder, 'project');
		mkdirSync(projectFolder);
	});

	afterEach(() => {
		rmSync(testFolder, { recursive: true, force: true });
	});

	it('reads a file using its virtual absolute path', async () => {
		writeFileSync(join(projectFolder, 'context.md'), 'project context', 'utf-8');

		await expect(readFileContent('/context.md', projectFolder)).resolves.toBe('project context');
	});

	it('rejects a lexical parent-directory escape', async () => {
		writeFileSync(join(testFolder, 'secret.txt'), 'outside', 'utf-8');

		await expect(readFileContent('../secret.txt', projectFolder)).rejects.toThrow(
			'Access denied: path is outside the project folder',
		);
	});

	it('rejects a final symlink that resolves outside the project folder', async () => {
		const secretPath = join(testFolder, 'secret.txt');
		writeFileSync(secretPath, 'outside', 'utf-8');
		symlinkSync(secretPath, join(projectFolder, 'secret.txt'));

		await expect(readFileContent('/secret.txt', projectFolder)).rejects.toThrow(
			'Access denied: path is outside the project folder',
		);
	});

	it('rejects a nested-directory symlink that resolves outside the project folder', async () => {
		const outsideFolder = join(testFolder, 'outside');
		mkdirSync(outsideFolder);
		writeFileSync(join(outsideFolder, 'secret.txt'), 'outside', 'utf-8');
		symlinkSync(outsideFolder, join(projectFolder, 'linked-directory'));

		await expect(readFileContent('/linked-directory/secret.txt', projectFolder)).rejects.toThrow(
			'Access denied: path is outside the project folder',
		);
	});
});
