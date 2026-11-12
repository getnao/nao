import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { getDocsContextCatalog, getFilesContextCatalog } from '../../src/services/file-tree-catalog.service';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const createTemporaryFolder = useTemporaryFolders();

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
		writeProjectFiles(project, {
			'docs/a-folder/b.md': 'b',
			'docs/root.md': 'root',
			'docs/ignored.md': 'ignored',
			'.naoignore': 'docs/ignored.md\n',
		});
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
		writeProjectFiles(target, { 'docs/secret.md': 'secret' });
		fs.symlinkSync(path.join(target, 'docs'), path.join(project, 'docs'));

		expect(getDocsContextCatalog(project)).toEqual({ syncState: 'missing', entries: [] });
	});

	it('includes a nested folder named docs', () => {
		const project = createProject();
		writeProjectFiles(project, { 'docs/docs/nested.md': 'nested' });

		expect(getDocsContextCatalog(project)).toEqual({
			syncState: 'ready',
			entries: [
				{ kind: 'folder', path: 'docs' },
				{ kind: 'file', path: 'docs/nested.md' },
			],
		});
	});
});

describe('project files context catalog', () => {
	it('reports a missing project folder', () => {
		const project = createProject();
		expect(getFilesContextCatalog(path.join(project, 'missing'))).toEqual({ syncState: 'missing', entries: [] });
	});

	it('reports a project path that is a file as missing', () => {
		const project = createProject();
		writeProjectFiles(project, { 'project.md': 'project' });

		expect(getFilesContextCatalog(path.join(project, 'project.md'))).toEqual({ syncState: 'missing', entries: [] });
	});

	it('reports a ready catalog with no entries when the project only holds the scoped roots', () => {
		const project = createProject();
		writeProjectFiles(project, { 'docs/guides/setup.md': 'setup', 'databases/query.sql': 'select 1' });

		expect(getFilesContextCatalog(project)).toEqual({ syncState: 'ready', entries: [] });
	});

	it('excludes the scoped roots and lists the other entries relative to the project root', () => {
		const project = createProject();
		fs.mkdirSync(path.join(project, 'z-folder'));
		writeProjectFiles(project, {
			'docs/ignored.md': 'ignored',
			'databases/ignored.sql': 'ignored',
			'a-folder/b.md': 'b',
			'root.md': 'root',
		});

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

	it('never offers nao_config.yaml at any depth or casing since the agent can never read it', () => {
		const project = createProject();
		writeProjectFiles(project, {
			'nao_config.yaml': 'llm: {}',
			'envs/NAO_CONFIG.YAML': 'llm: {}',
			'RULES.md': 'rules',
		});

		expect(getFilesContextCatalog(project)).toEqual({
			syncState: 'ready',
			entries: [
				{ kind: 'folder', path: 'envs' },
				{ kind: 'file', path: 'RULES.md' },
			],
		});
	});

	it('omits names the grant editor would normalize to a different path', () => {
		const project = createProject();
		writeProjectFiles(project, { 'reports/q1.md': 'q1', 'reports /secret.md': 'secret' });

		expect(getFilesContextCatalog(project)).toEqual({
			syncState: 'ready',
			entries: [
				{ kind: 'folder', path: 'reports' },
				{ kind: 'file', path: 'reports/q1.md' },
			],
		});
	});

	it('lists nested folders before their children with parent/child paths', () => {
		const project = createProject();
		writeProjectFiles(project, {
			'templates/partials/row.html': 'row',
			'templates/card.html': 'card',
		});

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
		writeProjectFiles(project, {
			'.git/config': 'config',
			'.meta/state.json': 'state',
			'home/private.md': 'private',
			'.env': 'SECRET=1',
			'.env.local': 'SECRET=2',
			'kept.md': 'kept',
			'ignored.md': 'ignored',
			'.naoignore': 'ignored.md\n',
		});

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
		writeProjectFiles(project, { 'templates/card.html': 'card', 'root.md': 'root' });
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
		writeProjectFiles(target, { 'templates/card.html': 'card' });
		fs.symlinkSync(target, path.join(project, 'linked'));

		expect(getFilesContextCatalog(path.join(project, 'linked'))).toEqual({ syncState: 'missing', entries: [] });
	});
});

function createProject(): string {
	return createTemporaryFolder('nao-file-tree-catalog-');
}

function writeProjectFiles(project: string, files: Record<string, string>): void {
	for (const [filePath, content] of Object.entries(files)) {
		const target = path.join(project, filePath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
	}
}
