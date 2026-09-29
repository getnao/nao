import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearNaoignoreCache, toRealPath, toVirtualPath } from '../src/utils/tools';

/**
 * `toRealPath` guards the agent's file tools. A lexical check alone lets a symlink inside the
 * project folder point anywhere on the host, because fs follows the link when the file is read.
 */
describe('toRealPath with symlinks', () => {
	let root: string;
	let projectFolder: string;
	let outside: string;

	beforeEach(() => {
		root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nao-symlink-')));
		projectFolder = path.join(root, 'project');
		outside = path.join(root, 'outside');
		fs.mkdirSync(projectFolder);
		fs.mkdirSync(outside);
		fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
		fs.writeFileSync(path.join(projectFolder, 'inside.txt'), 'inside');
		clearNaoignoreCache();
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	describe('symlinks escaping the project folder', () => {
		it('rejects a symlinked file that resolves outside the project folder', () => {
			fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(projectFolder, 'link.txt'));

			expect(() => toRealPath('/link.txt', projectFolder)).toThrow(/outside the project folder/);
		});

		it('rejects a path reached through a symlinked directory', () => {
			fs.symlinkSync(outside, path.join(projectFolder, 'linked-dir'));

			expect(() => toRealPath('/linked-dir/secret.txt', projectFolder)).toThrow(/outside the project folder/);
		});

		it('rejects a not-yet-existing nested path reached through a symlinked directory', () => {
			fs.symlinkSync(outside, path.join(projectFolder, 'linked-dir'));

			expect(() => toRealPath('/linked-dir/new/deep/file.txt', projectFolder)).toThrow(
				/outside the project folder/,
			);
		});
	});

	describe('symlinks targeting protected files', () => {
		it('rejects a symlink to an environment file', () => {
			fs.writeFileSync(path.join(projectFolder, '.env'), 'SECRET=1');
			fs.symlinkSync(path.join(projectFolder, '.env'), path.join(projectFolder, 'config.txt'));

			expect(() => toRealPath('/config.txt', projectFolder)).toThrow(/protected environment file/);
		});

		it('rejects a symlink into .git', () => {
			fs.mkdirSync(path.join(projectFolder, '.git'));
			fs.writeFileSync(path.join(projectFolder, '.git', 'config'), '');
			fs.symlinkSync(path.join(projectFolder, '.git'), path.join(projectFolder, 'metadata'));

			expect(() => toRealPath('/metadata/config', projectFolder)).toThrow(/protected .git metadata/);
		});

		it('rejects a symlink to a file ignored by .naoignore', () => {
			fs.writeFileSync(path.join(projectFolder, '.naoignore'), 'private/\n');
			fs.mkdirSync(path.join(projectFolder, 'private'));
			fs.writeFileSync(path.join(projectFolder, 'private', 'notes.md'), '');
			fs.symlinkSync(path.join(projectFolder, 'private', 'notes.md'), path.join(projectFolder, 'notes.md'));

			expect(() => toRealPath('/notes.md', projectFolder)).toThrow(/ignored by .naoignore/);
		});
	});

	describe('legitimate paths', () => {
		it('still resolves a regular file inside the project folder', () => {
			expect(toRealPath('/inside.txt', projectFolder)).toBe(path.join(projectFolder, 'inside.txt'));
		});

		it('still resolves a file that does not exist yet', () => {
			expect(toRealPath('/new/deep/file.txt', projectFolder)).toBe(path.join(projectFolder, 'new/deep/file.txt'));
		});

		it('accepts a symlink that stays inside the project folder', () => {
			fs.symlinkSync(path.join(projectFolder, 'inside.txt'), path.join(projectFolder, 'alias.txt'));

			expect(toRealPath('/alias.txt', projectFolder)).toBe(path.join(projectFolder, 'alias.txt'));
		});

		it('lets a caller with its own symlink policy resolve the link itself', () => {
			fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(projectFolder, 'link.txt'));

			expect(toRealPath('/link.txt', projectFolder, { resolveSymlinks: false })).toBe(
				path.join(projectFolder, 'link.txt'),
			);
		});
	});

	describe('project folder reached through a symlink', () => {
		let alias: string;

		beforeEach(() => {
			alias = path.join(root, 'project-alias');
			fs.symlinkSync(projectFolder, alias);
		});

		it('accepts an existing file and keeps the caller-facing path', () => {
			expect(toRealPath('/inside.txt', alias)).toBe(path.join(alias, 'inside.txt'));
		});

		it('accepts a not-yet-existing nested path', () => {
			expect(toRealPath('/new/deep/file.txt', alias)).toBe(path.join(alias, 'new/deep/file.txt'));
		});

		it('round-trips through toVirtualPath', () => {
			expect(toVirtualPath(toRealPath('/inside.txt', alias), alias)).toBe('/inside.txt');
		});

		it('still rejects a symlink escaping the project folder', () => {
			fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(projectFolder, 'link.txt'));

			expect(() => toRealPath('/link.txt', alias)).toThrow(/outside the project folder/);
		});
	});
});
