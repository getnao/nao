import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { getDocsContextCatalog } from '../src/services/docs-context-catalog.service';

const temporaryFolders: string[] = [];

afterEach(() => {
	for (const folder of temporaryFolders.splice(0)) {
		fs.rmSync(folder, { recursive: true, force: true });
	}
});

describe('docs context catalog', () => {
	it('distinguishes a missing docs folder from an empty one', () => {
		const project = createProject();
		expect(getDocsContextCatalog(project)).toEqual({ syncState: 'missing', entries: [] });

		fs.mkdirSync(path.join(project, 'docs'));
		expect(getDocsContextCatalog(project)).toEqual({ syncState: 'ready', entries: [] });
	});

	it('scans nested docs with directories first and excludes ignored entries and symlinks', () => {
		const project = createProject();
		fs.mkdirSync(path.join(project, 'docs', 'z-folder'), { recursive: true });
		fs.mkdirSync(path.join(project, 'docs', 'a-folder'), { recursive: true });
		fs.writeFileSync(path.join(project, 'docs', 'a-folder', 'b.md'), 'b');
		fs.writeFileSync(path.join(project, 'docs', 'root.md'), 'root');
		fs.writeFileSync(path.join(project, 'docs', 'ignored.md'), 'ignored');
		fs.writeFileSync(path.join(project, '.naoignore'), 'docs/ignored.md\n');
		fs.symlinkSync(path.join(project, 'docs', 'root.md'), path.join(project, 'docs', 'alias.md'));

		expect(getDocsContextCatalog(project)).toEqual({
			syncState: 'ready',
			entries: [
				{ kind: 'folder', path: 'a-folder' },
				{ kind: 'file', path: 'a-folder/b.md' },
				{ kind: 'folder', path: 'z-folder' },
				{ kind: 'file', path: 'root.md' },
			],
		});
	});

	it('does not follow a symlink used as the docs root', () => {
		const project = createProject();
		const target = createProject();
		fs.mkdirSync(path.join(target, 'docs'));
		fs.writeFileSync(path.join(target, 'docs', 'secret.md'), 'secret');
		fs.symlinkSync(path.join(target, 'docs'), path.join(project, 'docs'));

		expect(getDocsContextCatalog(project)).toEqual({ syncState: 'missing', entries: [] });
	});

	it('includes a nested folder named docs', () => {
		const project = createProject();
		fs.mkdirSync(path.join(project, 'docs', 'docs'), { recursive: true });
		fs.writeFileSync(path.join(project, 'docs', 'docs', 'nested.md'), 'nested');

		expect(getDocsContextCatalog(project)).toEqual({
			syncState: 'ready',
			entries: [
				{ kind: 'folder', path: 'docs' },
				{ kind: 'file', path: 'docs/nested.md' },
			],
		});
	});
});

function createProject(): string {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-docs-context-'));
	temporaryFolders.push(folder);
	return folder;
}
