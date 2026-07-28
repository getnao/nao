import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	getFileTree,
	MAX_CONTEXT_FILE_SIZE,
	readFileContent,
	writeFileContent,
} from '../src/services/context-explorer.service';

describe('context explorer file writes', () => {
	let projectFolder: string;

	beforeEach(() => {
		projectFolder = mkdtempSync(join(tmpdir(), 'nao-context-explorer-write-'));
		execFileSync('git', ['init', '--quiet'], { cwd: projectFolder, stdio: 'pipe' });
		writeFileSync(join(projectFolder, 'context.md'), 'original content\n');
	});

	afterEach(() => {
		rmSync(projectFolder, { recursive: true, force: true });
	});

	it('reads, writes, and returns the new content hash', async () => {
		const original = await readFileContent('/context.md', projectFolder);
		const writeResult = await writeFileContent('/context.md', 'updated content\n', original.hash, projectFolder);
		const updated = await readFileContent('/context.md', projectFolder);

		expect(updated.content).toBe('updated content\n');
		expect(writeResult.hash).toBe(updated.hash);
	});

	it('rejects a stale expected hash', async () => {
		const original = await readFileContent('/context.md', projectFolder);
		await writeFileContent('/context.md', 'first update\n', original.hash, projectFolder);

		await expect(
			writeFileContent('/context.md', 'stale update\n', original.hash, projectFolder),
		).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(readFileSync(join(projectFolder, 'context.md'), 'utf-8')).toBe('first update\n');
	});

	it('rejects writes when the project folder is not a git repository', async () => {
		const nonRepositoryFolder = mkdtempSync(join(tmpdir(), 'nao-context-explorer-non-repo-'));
		const filePath = join(nonRepositoryFolder, 'context.md');
		writeFileSync(filePath, 'original content\n');
		const original = await readFileContent('/context.md', nonRepositoryFolder);

		try {
			await expect(
				writeFileContent('/context.md', 'updated content\n', original.hash, nonRepositoryFolder),
			).rejects.toMatchObject({
				code: 'FORBIDDEN',
				message: 'Editing requires the project folder to be a git repository.',
			});
			expect(readFileSync(filePath, 'utf-8')).toBe('original content\n');
		} finally {
			rmSync(nonRepositoryFolder, { recursive: true, force: true });
		}
	});

	it('rejects a path that does not exist', async () => {
		const original = await readFileContent('/context.md', projectFolder);

		await expect(
			writeFileContent('/missing.md', 'new content\n', original.hash, projectFolder),
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('rejects path traversal', async () => {
		const original = await readFileContent('/context.md', projectFolder);

		await expect(
			writeFileContent('../outside.md', 'new content\n', original.hash, projectFolder),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});

	it('excludes .git directories from the file tree at any depth', async () => {
		mkdirSync(join(projectFolder, 'nested', '.git'), { recursive: true });
		writeFileSync(join(projectFolder, 'nested', '.git', 'config'), 'nested git config\n');

		const tree = await getFileTree(projectFolder);
		const nested = tree.find((entry) => entry.name === 'nested');

		expect(tree.map((entry) => entry.name)).not.toContain('.git');
		expect(nested?.type).toBe('directory');
		expect(nested?.children?.map((entry) => entry.name)).not.toContain('.git');
	});

	it('rejects reads inside .git', async () => {
		await expect(readFileContent('/.git/HEAD', projectFolder)).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: expect.stringContaining('protected .git metadata'),
		});
	});

	it('rejects writes inside .git without changing the file', async () => {
		const headPath = join(projectFolder, '.git', 'HEAD');
		const originalHead = readFileSync(headPath, 'utf-8');
		const original = await readFileContent('/context.md', projectFolder);

		await expect(writeFileContent('/.git/HEAD', 'corrupted\n', original.hash, projectFolder)).rejects.toMatchObject(
			{
				code: 'FORBIDDEN',
				message: expect.stringContaining('protected .git metadata'),
			},
		);
		expect(readFileSync(headPath, 'utf-8')).toBe(originalHead);
	});

	it('excludes and rejects writes to .git pointer files', async () => {
		const nestedRepository = join(projectFolder, 'nested-repository');
		const gitPointerPath = join(nestedRepository, '.git');
		const gitPointer = 'gitdir: ../.git/modules/nested-repository\n';
		mkdirSync(nestedRepository);
		writeFileSync(gitPointerPath, gitPointer);
		const original = await readFileContent('/context.md', projectFolder);

		const tree = await getFileTree(projectFolder);
		const nested = tree.find((entry) => entry.name === 'nested-repository');

		expect(nested?.type).toBe('directory');
		expect(nested?.children?.map((entry) => entry.name)).not.toContain('.git');
		await expect(
			writeFileContent('/nested-repository/.git', 'gitdir: elsewhere\n', original.hash, projectFolder),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: expect.stringContaining('protected .git metadata'),
		});
		expect(readFileSync(gitPointerPath, 'utf-8')).toBe(gitPointer);
	});

	it('keeps legitimate git-related files visible, readable, and writable', async () => {
		writeFileSync(join(projectFolder, '.gitignore'), 'ignored.txt\n');
		writeFileSync(join(projectFolder, '.gitkeep'), 'keep\n');
		writeFileSync(join(projectFolder, '.gitattributes'), '* text=auto\n');

		const tree = await getFileTree(projectFolder);
		const names = tree.map((entry) => entry.name);
		const gitignore = await readFileContent('/.gitignore', projectFolder);
		const gitkeep = await readFileContent('/.gitkeep', projectFolder);
		const gitattributes = await readFileContent('/.gitattributes', projectFolder);

		expect(names).toEqual(expect.arrayContaining(['.gitignore', '.gitkeep', '.gitattributes']));
		expect(gitignore.content).toBe('ignored.txt\n');
		expect(gitkeep.content).toBe('keep\n');
		expect(gitattributes.content).toBe('* text=auto\n');

		await writeFileContent('/.gitignore', 'updated-ignore.txt\n', gitignore.hash, projectFolder);
		expect((await readFileContent('/.gitignore', projectFolder)).content).toBe('updated-ignore.txt\n');
	});

	it('rejects symlinks outside the project without changing their target', async () => {
		const outsideFolder = mkdtempSync(join(tmpdir(), 'nao-context-explorer-outside-'));
		const outsideFile = join(outsideFolder, 'outside.md');
		writeFileSync(outsideFile, 'outside content\n');
		symlinkSync(outsideFile, join(projectFolder, 'linked.md'));
		const original = await readFileContent('/context.md', projectFolder);

		try {
			await expect(
				writeFileContent('/linked.md', 'changed content\n', original.hash, projectFolder),
			).rejects.toMatchObject({ code: 'FORBIDDEN' });
			expect(readFileSync(outsideFile, 'utf-8')).toBe('outside content\n');
		} finally {
			rmSync(outsideFolder, { recursive: true, force: true });
		}
	});

	it('rejects oversized content', async () => {
		const original = await readFileContent('/context.md', projectFolder);

		await expect(
			writeFileContent('/context.md', 'a'.repeat(MAX_CONTEXT_FILE_SIZE + 1), original.hash, projectFolder),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});

	it('preserves the file mode', async () => {
		const filePath = join(projectFolder, 'context.md');
		chmodSync(filePath, 0o600);
		const original = await readFileContent('/context.md', projectFolder);

		await writeFileContent('/context.md', 'updated content\n', original.hash, projectFolder);

		expect(statSync(filePath).mode & 0o777).toBe(0o600);
	});

	it('allows exactly one concurrent write with the same expected hash', async () => {
		const original = await readFileContent('/context.md', projectFolder);
		const contents = ['first complete update\n', 'second complete update\n'];
		const results = await Promise.allSettled(
			contents.map((content) => writeFileContent('/context.md', content, original.hash, projectFolder)),
		);

		const successes = results.filter((result) => result.status === 'fulfilled');
		const failures = results.filter((result) => result.status === 'rejected');
		expect(successes).toHaveLength(1);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({ reason: { code: 'CONFLICT' } });
		expect(contents).toContain(readFileSync(join(projectFolder, 'context.md'), 'utf-8'));
	});

	it('rejects files hidden by .naoignore', async () => {
		writeFileSync(join(projectFolder, 'ignored.md'), 'hidden content\n');
		writeFileSync(join(projectFolder, '.naoignore'), 'ignored.md\n');
		const original = await readFileContent('/context.md', projectFolder);

		await expect(
			writeFileContent('/ignored.md', 'changed content\n', original.hash, projectFolder),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});
