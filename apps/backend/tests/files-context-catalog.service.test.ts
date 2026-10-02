import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { getFilesContextCatalog } from '../src/services/files-context-catalog.service';

const temporaryFolders: string[] = [];

afterEach(() => {
	for (const folder of temporaryFolders.splice(0)) {
		fs.rmSync(folder, { recursive: true, force: true });
	}
});

describe('files context catalog', () => {
	it('reports a missing project folder', () => {
		const project = createProject();
		expect(getFilesContextCatalog(path.join(project, 'missing'))).toEqual({ syncState: 'missing', entries: [] });
	});

	it('reports a project path that is a file as missing', () => {
		const project = createProject();
		const file = path.join(project, 'project.md');
		fs.writeFileSync(file, 'project');

		expect(getFilesContextCatalog(file)).toEqual({ syncState: 'missing', entries: [] });
	});

	it('reports a ready catalog with no entries when the project only holds the scoped roots', () => {
		const project = createProject();
		fs.mkdirSync(path.join(project, 'docs', 'guides'), { recursive: true });
		fs.mkdirSync(path.join(project, 'databases'), { recursive: true });
		fs.writeFileSync(path.join(project, 'docs', 'guides', 'setup.md'), 'setup');
		fs.writeFileSync(path.join(project, 'databases', 'query.sql'), 'select 1');

		expect(getFilesContextCatalog(project)).toEqual({ syncState: 'ready', entries: [] });
	});

	it('excludes the scoped roots and lists the other entries relative to the project root', () => {
		const project = createProject();
		fs.mkdirSync(path.join(project, 'docs'), { recursive: true });
		fs.mkdirSync(path.join(project, 'databases'), { recursive: true });
		fs.mkdirSync(path.join(project, 'z-folder'), { recursive: true });
		fs.mkdirSync(path.join(project, 'a-folder'), { recursive: true });
		fs.writeFileSync(path.join(project, 'docs', 'ignored.md'), 'ignored');
		fs.writeFileSync(path.join(project, 'databases', 'ignored.sql'), 'ignored');
		fs.writeFileSync(path.join(project, 'a-folder', 'b.md'), 'b');
		fs.writeFileSync(path.join(project, 'root.md'), 'root');

		expect(getFilesContextCatalog(project)).toEqual({
			syncState: 'ready',
			entries: [
				{ kind: 'folder', path: 'a-folder' },
				{ kind: 'file', path: 'a-folder/b.md' },
				{ kind: 'folder', path: 'z-folder' },
				{ kind: 'file', path: 'root.md' },
			],
		});
	});

	it('lists nested folders before their children with parent/child paths', () => {
		const project = createProject();
		fs.mkdirSync(path.join(project, 'templates', 'partials'), { recursive: true });
		fs.writeFileSync(path.join(project, 'templates', 'partials', 'row.html'), 'row');
		fs.writeFileSync(path.join(project, 'templates', 'card.html'), 'card');

		expect(getFilesContextCatalog(project)).toEqual({
			syncState: 'ready',
			entries: [
				{ kind: 'folder', path: 'templates' },
				{ kind: 'folder', path: 'templates/partials' },
				{ kind: 'file', path: 'templates/partials/row.html' },
				{ kind: 'file', path: 'templates/card.html' },
			],
		});
	});

	it('omits excluded entries and naoignore matches', () => {
		const project = createProject();
		fs.mkdirSync(path.join(project, '.git', 'objects'), { recursive: true });
		fs.mkdirSync(path.join(project, '.meta'), { recursive: true });
		fs.mkdirSync(path.join(project, 'home'), { recursive: true });
		fs.writeFileSync(path.join(project, '.git', 'config'), 'config');
		fs.writeFileSync(path.join(project, '.meta', 'state.json'), 'state');
		fs.writeFileSync(path.join(project, 'home', 'private.md'), 'private');
		fs.writeFileSync(path.join(project, '.env'), 'SECRET=1');
		fs.writeFileSync(path.join(project, '.env.local'), 'SECRET=2');
		fs.writeFileSync(path.join(project, 'kept.md'), 'kept');
		fs.writeFileSync(path.join(project, 'ignored.md'), 'ignored');
		fs.writeFileSync(path.join(project, '.naoignore'), 'ignored.md\n');

		expect(getFilesContextCatalog(project)).toEqual({
			syncState: 'ready',
			entries: [
				{ kind: 'file', path: '.naoignore' },
				{ kind: 'file', path: 'kept.md' },
			],
		});
	});

	it('skips symlinked entries', () => {
		const project = createProject();
		fs.mkdirSync(path.join(project, 'templates'));
		fs.writeFileSync(path.join(project, 'templates', 'card.html'), 'card');
		fs.writeFileSync(path.join(project, 'root.md'), 'root');
		fs.symlinkSync(path.join(project, 'root.md'), path.join(project, 'alias.md'));
		fs.symlinkSync(path.join(project, 'templates'), path.join(project, 'templates-alias'));

		expect(getFilesContextCatalog(project)).toEqual({
			syncState: 'ready',
			entries: [
				{ kind: 'folder', path: 'templates' },
				{ kind: 'file', path: 'templates/card.html' },
				{ kind: 'file', path: 'root.md' },
			],
		});
	});

	it('does not follow a symlink used as the project folder', () => {
		const project = createProject();
		const target = createProject();
		fs.mkdirSync(path.join(target, 'templates'));
		fs.writeFileSync(path.join(target, 'templates', 'card.html'), 'card');
		fs.symlinkSync(target, path.join(project, 'linked'));

		expect(getFilesContextCatalog(path.join(project, 'linked'))).toEqual({ syncState: 'missing', entries: [] });
	});
});

function createProject(): string {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-files-context-'));
	temporaryFolders.push(folder);
	return folder;
}
