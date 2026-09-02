import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toRealPath } from '../src/utils/tools';

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
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('rejects a symlinked file that resolves outside the project folder', () => {
		fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(projectFolder, 'link.txt'));

		expect(() => toRealPath('/link.txt', projectFolder)).toThrow(/outside the project folder/);
	});

	it('rejects a path reached through a symlinked directory', () => {
		fs.symlinkSync(outside, path.join(projectFolder, 'linked-dir'));

		expect(() => toRealPath('/linked-dir/secret.txt', projectFolder)).toThrow(/outside the project folder/);
	});

	it('still resolves a regular file inside the project folder', () => {
		expect(toRealPath('/inside.txt', projectFolder)).toBe(path.join(projectFolder, 'inside.txt'));
	});

	it('still resolves a file that does not exist yet', () => {
		expect(toRealPath('/new/file.txt', projectFolder)).toBe(path.join(projectFolder, 'new/file.txt'));
	});

	it('accepts a project folder that is itself reached through a symlink', () => {
		const alias = path.join(root, 'project-alias');
		fs.symlinkSync(projectFolder, alias);

		expect(toRealPath('/inside.txt', alias)).toBe(path.join(projectFolder, 'inside.txt'));
	});
});
