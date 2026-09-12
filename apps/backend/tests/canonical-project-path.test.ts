import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveCanonicalProjectPath } from '../src/utils/tools';

const temporaryFolders: string[] = [];

afterEach(() => {
	for (const folder of temporaryFolders.splice(0)) {
		fs.rmSync(folder, { recursive: true, force: true });
	}
});

describe('canonical project paths', () => {
	it('resolves a symlinked existing ancestor before appending missing segments', () => {
		const root = createTemporaryFolder();
		const project = path.join(root, 'project');
		const realDirectory = path.join(project, 'real');
		fs.mkdirSync(realDirectory, { recursive: true });
		fs.symlinkSync(realDirectory, path.join(project, 'alias'), directoryLinkType());

		expect(resolveCanonicalProjectPath('/alias/missing/report.md', project)).toEqual({
			realPath: path.join(fs.realpathSync.native(realDirectory), 'missing', 'report.md'),
			virtualPath: '/real/missing/report.md',
		});
	});

	it('rejects a missing target beneath a symlinked ancestor outside the project', () => {
		const root = createTemporaryFolder();
		const project = path.join(root, 'project');
		const outside = path.join(root, 'outside');
		fs.mkdirSync(project);
		fs.mkdirSync(outside);
		fs.symlinkSync(outside, path.join(project, 'escape'), directoryLinkType());

		expect(() => resolveCanonicalProjectPath('/escape/missing.md', project)).toThrow(
			'resolves outside the project folder',
		);
	});
});

function createTemporaryFolder(): string {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-canonical-path-'));
	temporaryFolders.push(folder);
	return folder;
}

function directoryLinkType(): 'dir' | 'junction' {
	return process.platform === 'win32' ? 'junction' : 'dir';
}
