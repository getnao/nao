import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
	process.env.NAO_CONTEXT_SOURCE = 'local';
});

import type { ContextExplorerFileAccess } from '../../src/services/context-explorer.service';
import {
	getFileTree,
	MAX_CONTEXT_FILE_SIZE,
	readFileContent,
	searchFileContents,
	writeFileContent,
} from '../../src/services/context-explorer.service';
import {
	baseContext,
	type ContextGitFixture,
	createContextGitFixture,
	expectLiveUnchanged,
	fileAccess,
	snapshot,
	writeFiles,
} from '../helpers/context-git-fixture';
import { useTemporaryFolders } from '../helpers/temporary-folders';

describe('context explorer worktree writes', () => {
	const createTemporaryFolder = useTemporaryFolders();
	let fixture: ContextGitFixture;
	let access: ContextExplorerFileAccess;
	let liveSnapshot: Record<string, Buffer>;

	beforeEach(async () => {
		fixture = createContextGitFixture(createTemporaryFolder('nao-context-write-'), {
			'nao_config.yaml': 'name: project\n',
			'context.md': 'repository content\n',
			'generated.md': '---\ntype: generated\n---\ngenerated\n',
			'annotations.md': '---\ntype: manual\n---\nnotes\n',
			'rendered.md': 'rendered\n',
			'rendered.md.j2': 'template\n',
			'repos/source.md': 'synced\n',
			'docs/notion/page.md': 'notion\n',
			'docs/confluence/page.md': 'confluence\n',
			'docs/obsidian/note.md': 'obsidian\n',
			'.gitignore': 'ignored\n',
		});
		writeFiles(fixture.live, {
			'nao_config.yaml': 'name: live\n',
			'context.md': 'live content\n',
			'generated.md': '---\ntype: generated\n---\nlive generated\n',
			'annotations.md': 'live notes\n',
			'rendered.md': 'live rendered\n',
			'rendered.md.j2': 'live template\n',
			'repos/source.md': 'live synced\n',
			'docs/notion/page.md': 'live notion\n',
			'docs/confluence/page.md': 'live confluence\n',
			'docs/obsidian/note.md': 'live obsidian\n',
			'untracked.md': 'live only\n',
			'.env': 'secret\n',
			'nested/.env.local': 'nested secret\n',
			'nested/repository/.git/config': 'protected\n',
		});
		liveSnapshot = snapshot(fixture.live);
		access = await fileAccess(fixture.context);
	});

	it('reads and writes tracked content only in the worktree with optimistic locking', async () => {
		const original = await readFileContent('/context.md', access);
		const result = await writeFileContent('/context.md', 'updated\n', original.hash, access);
		const updated = await readFileContent('/context.md', access);

		expect(original.content).toBe('repository content\n');
		expect(updated.content).toBe('updated\n');
		expect(result.hash).toBe(updated.hash);
		await expect(writeFileContent('/context.md', 'stale\n', original.hash, access)).rejects.toMatchObject({
			code: 'CONFLICT',
		});
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it('browses the live project read-only when no repository is connected', async () => {
		const readOnlyAccess = await fileAccess(baseContext(fixture.live, null));
		const tree = await getFileTree(fixture.live);
		const file = await readFileContent('/context.md', readOnlyAccess);

		expect(tree.map((entry) => entry.name)).toContain('context.md');
		expect(file).toMatchObject({
			content: 'live content\n',
			isEditable: false,
			reason: 'no-repo',
		});
		await expect(writeFileContent('/context.md', 'changed\n', file.hash, readOnlyAccess)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it('returns every editability reason with actionable guidance in precedence order', async () => {
		const generated = await readFileContent('/generated.md', access);
		const rendered = await readFileContent('/rendered.md', access);
		const repoSource = await readFileContent('/repos/source.md', access);
		const notion = await readFileContent('/docs/notion/page.md', access);
		const untracked = await readFileContent('/untracked.md', access);

		expect(generated).toMatchObject({
			reason: 'generated',
			guidance: { actionKind: 'file', actionPath: '/annotations.md' },
		});
		expect(rendered).toMatchObject({
			reason: 'rendered-template',
			guidance: { actionKind: 'file', actionPath: '/rendered.md.j2' },
		});
		expect(repoSource).toMatchObject({
			reason: 'synced-source',
			guidance: { actionKind: 'file', actionPath: '/nao_config.yaml' },
		});
		expect(notion.reason).toBe('synced-source');
		expect(untracked).toMatchObject({
			reason: 'not-tracked',
			guidance: { message: expect.stringContaining('Add it') },
		});
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it('excludes and rejects .git and environment files across tree, read, write, and search', async () => {
		const tree = await getFileTree(fixture.live);
		const nested = tree.find((entry) => entry.name === 'nested');
		const context = await readFileContent('/context.md', access);

		expect(tree.map((entry) => entry.name)).not.toEqual(expect.arrayContaining(['.git', '.env']));
		expect(nested?.children?.map((entry) => entry.name)).not.toContain('.env.local');
		for (const protectedPath of ['/nested/repository/.git/config', '/.env', '/nested/.env.local']) {
			await expect(readFileContent(protectedPath, access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
			await expect(writeFileContent(protectedPath, 'changed\n', context.hash, access)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		}
		expect((await searchFileContents('secret', fixture.live)).results).toEqual([]);
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it('rejects traversal, symlinks, oversized and non-UTF-8 files', async () => {
		const context = await readFileContent('/context.md', access);
		const repo = access.git.status === 'available' ? access.git.repo : null;
		expect(repo).not.toBeNull();
		const worktreeProject = repo!.projectPrefix
			? path.join(repo!.worktreeRoot, repo!.projectPrefix)
			: repo!.worktreeRoot;
		const outside = path.join(fixture.root, 'outside.md');
		fs.writeFileSync(outside, 'outside\n');
		fs.symlinkSync(outside, path.join(worktreeProject, 'linked.md'));
		fs.writeFileSync(path.join(worktreeProject, 'context.md'), Buffer.from([0xff, 0xfe]));

		await expect(writeFileContent('../outside.md', 'changed\n', context.hash, access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(writeFileContent('/linked.md', 'changed\n', context.hash, access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(
			writeFileContent('/context.md', 'a'.repeat(MAX_CONTEXT_FILE_SIZE + 1), context.hash, access),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(readFileContent('/context.md', access)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(fs.readFileSync(outside, 'utf8')).toBe('outside\n');
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it('preserves file mode and permits only one concurrent atomic write', async () => {
		const repo = access.git.status === 'available' ? access.git.repo : null;
		const target = path.join(repo!.worktreeRoot, 'context.md');
		fs.chmodSync(target, 0o600);
		const original = await readFileContent('/context.md', access);
		const results = await Promise.allSettled([
			writeFileContent('/context.md', 'first\n', original.hash, access),
			writeFileContent('/context.md', 'second\n', original.hash, access),
		]);

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
		expect(fs.statSync(target).mode & 0o777).toBe(0o600);
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it.each([
		['/docs/notion/page.md', 'synced-source', 'file', '/nao_config.yaml'],
		['/docs/confluence/page.md', 'synced-source', 'file', '/nao_config.yaml'],
		['/docs/obsidian/note.md', 'synced-source', 'file', '/nao_config.yaml'],
		['/untracked.md', 'not-tracked', null, null],
	])('reports guidance for %s', async (filePath, reason, actionKind, actionPath) => {
		const file = await readFileContent(filePath, access);
		expect(file.reason).toBe(reason);
		expect(file.guidance?.actionKind).toBe(actionKind);
		expect(file.guidance?.actionPath).toBe(actionPath);
	});

	it.each(['/generated.md', '/rendered.md', '/repos/source.md', '/untracked.md'])(
		'rejects read-only write %s',
		async (filePath) => {
			const file = await readFileContent(filePath, access);
			await expect(writeFileContent(filePath, 'changed\n', file.hash, access)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		},
	);
});
